import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError, createApi } from "../src/api/client";
import { mapCompanyDetail, mapCompanyList } from "../src/api/companies";
import { CompaniesPage } from "../src/companies/CompaniesPage";
import { CompanyCreatePage } from "../src/companies/CompanyCreatePage";
import { COUNTRY_CODES, countryName, countryOptions } from "../src/companies/countries";
import { checkAddress, checkCompany, checkContact, companyFields, contactFields, differingFields, emptyCompanyDraft, serverFieldErrors } from "../src/companies/forms";
import { Intent, newIdempotencyKey } from "../src/companies/idempotency";
import { companiesRoute, companyPath } from "../src/companies/shared";
import { MESSAGES, type Locale } from "../src/i18n";
import { I18nProvider } from "../src/i18n/context";
import { accessPayload, API, apiError, fakeFetch, sessionPayload, text } from "./support";

const COMPANY_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const company = {
  id: COMPANY_ID, code: "B2B-000007", legalName: "Mobila Lux SRL", displayName: "Mobila Lux", countryCode: "RO", taxIdentifier: "RO12345678", vatNumber: null,
  registrationNumber: "J12/345/2019", website: "https://mobila-lux.ro", internalNotes: "Client important.", status: "active", statusChangedAt: null,
  createdAt: "2026-10-04T09:00:00.000Z", updatedAt: "2026-10-04T10:00:00.000Z", createdBy: { id: "e1", displayName: "Elena" }, updatedBy: { id: "e1", displayName: "Elena" }, version: 3,
};
const capabilities = { canView: true, canCreate: true, canUpdate: true, canManageStatus: false };
const detailPayload = { companyId: COMPANY_ID, company, contacts: [], addresses: [], capabilities };

async function signedIn(handler: Parameters<typeof fakeFetch>[0]) {
  const fake = fakeFetch((call) => (call.url.pathname === "/auth/session" ? { body: sessionPayload() } : handler(call)));
  const api = createApi(API, fake.fetchImpl);
  await api.getSession();
  return { api, calls: fake.calls };
}

test("the list request carries search, filters and the keyset cursor; nothing is filtered in the browser", async () => {
  const { api, calls } = await signedIn(() => ({ body: { items: [], nextCursor: null, capabilities } }));
  await api.listCompanies({ search: "  mobila ", status: "inactive", country: "RO", cursor: "abc", limit: 50 });
  const call = calls.at(-1)!;
  assert.equal(call.method, "GET");
  assert.equal(call.url.pathname, "/b2b/companies");
  assert.deepEqual(Object.fromEntries(call.url.searchParams), { search: "mobila", status: "inactive", country: "RO", cursor: "abc", limit: "50" });
  assert.equal(call.credentials, "include");
  assert.equal(call.headers["Idempotency-Key"], undefined, "reads carry no idempotency key");
  assert.equal(call.headers["X-CSRF-Token"], undefined);
});

test("mutations send the CSRF token, an Idempotency-Key and only documented fields", async () => {
  const { api, calls } = await signedIn(() => ({ status: 201, body: detailPayload }));
  const fields = { legalName: "Mobila Lux SRL", displayName: null, countryCode: "RO", taxIdentifier: "RO12345678", vatNumber: null, registrationNumber: null, website: null, internalNotes: null };
  const created = await api.createCompany({ ...fields, contact: null, address: null }, { idempotencyKey: "key-0000000000000001" });
  assert.equal(created.companyId, COMPANY_ID);
  assert.equal(created.detail?.company.code, "B2B-000007");
  const post = calls.at(-1)!;
  assert.equal(post.method, "POST");
  assert.equal(post.headers["X-CSRF-Token"], "csrf-token-1");
  assert.equal(post.headers["Idempotency-Key"], "key-0000000000000001");
  assert.deepEqual(Object.keys(post.body as object).sort(), ["address", "contact", "countryCode", "displayName", "internalNotes", "legalName", "registrationNumber", "taxIdentifier", "vatNumber", "website"]);
  assert.ok(!("id" in (post.body as object)) && !("code" in (post.body as object)), "the browser never sends an id or a code");

  await api.updateCompany(COMPANY_ID, fields, 3, { idempotencyKey: "key-0000000000000002" });
  assert.equal(calls.at(-1)!.method, "PUT");
  assert.equal((calls.at(-1)!.body as { expectedVersion: number }).expectedVersion, 3);
  const paths: Array<[() => Promise<unknown>, string, string]> = [
    [() => api.setCompanyStatus(COMPANY_ID, "inactive", 3, { idempotencyKey: "key-0000000000000003" }), "POST", `/b2b/companies/${COMPANY_ID}/deactivate`],
    [() => api.setCompanyStatus(COMPANY_ID, "active", 4, { idempotencyKey: "key-0000000000000004" }), "POST", `/b2b/companies/${COMPANY_ID}/reactivate`],
    [() => api.createContact(COMPANY_ID, { name: "Ana", jobTitle: null, email: null, phone: null, isPrimary: true }, { idempotencyKey: "key-0000000000000005" }), "POST", `/b2b/companies/${COMPANY_ID}/contacts`],
    [() => api.setContactStatus(COMPANY_ID, "c1", "inactive", 1, { idempotencyKey: "key-0000000000000006" }), "POST", `/b2b/companies/${COMPANY_ID}/contacts/c1/deactivate`],
    [() => api.updateAddress(COMPANY_ID, "a1", { type: "delivery", label: null, countryCode: "RO", countyRegion: null, city: "Cluj", postalCode: null, addressLine1: "Str. 1", addressLine2: null, isPrimary: false }, 2, { idempotencyKey: "key-0000000000000007" }), "PUT", `/b2b/companies/${COMPANY_ID}/addresses/a1`],
    [() => api.setAddressStatus(COMPANY_ID, "a1", "active", 3, { idempotencyKey: "key-0000000000000008" }), "POST", `/b2b/companies/${COMPANY_ID}/addresses/a1/reactivate`],
  ];
  for (const [send, method, pathname] of paths) {
    await send();
    const call = calls.at(-1)!;
    assert.equal(`${call.method} ${call.url.pathname}`, `${method} ${pathname}`);
    assert.ok(call.headers["Idempotency-Key"]?.startsWith("key-"));
  }
});

test("server field errors and the duplicate company reference reach the UI as data, never as server text", async () => {
  const { api } = await signedIn(() => apiError("VALIDATION_FAILED", 422, { fields: { legalName: "required", "contact.email": "invalid", bogus: 3 } }));
  await assert.rejects(api.getCompany(COMPANY_ID), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.deepEqual(error.fields, { legalName: "required", "contact.email": "invalid" });
    assert.deepEqual(serverFieldErrors(error), { legalName: "required", "contact.email": "invalid" });
    return true;
  });
  const conflict = await signedIn(() => apiError("COMPANY_TAX_ID_ALREADY_EXISTS", 409, { company: { id: COMPANY_ID, code: "B2B-000007" } }));
  await assert.rejects(conflict.api.listCompanies(), (error: unknown) => error instanceof ApiError && error.code === "COMPANY_TAX_ID_ALREADY_EXISTS" && (error.details as { company: { code: string } }).company.code === "B2B-000007");
});

test("company responses are mapped strictly and fail closed", () => {
  assert.equal(mapCompanyDetail(detailPayload).company.version, 3);
  assert.throws(() => mapCompanyDetail({ ...detailPayload, company: { ...company, status: "deleted" } }), /INVALID_RESPONSE/);
  assert.throws(() => mapCompanyDetail({ ...detailPayload, addresses: [{ type: "warehouse" }] }), /INVALID_RESPONSE/);
  assert.throws(() => mapCompanyList({ items: "x", nextCursor: null, capabilities }), /INVALID_RESPONSE/);
  const list = mapCompanyList({ items: [{ id: COMPANY_ID, code: "B2B-000007", legalName: "Mobila", displayName: null, countryCode: "RO", taxIdentifier: "1", city: null, primaryContact: null, status: "inactive", updatedAt: "2026-10-04T10:00:00.000Z" }], nextCursor: "c", capabilities });
  assert.equal(list.items[0].status, "inactive");
  assert.equal(list.nextCursor, "c");
});

test("the gate keeps only known company permissions and treats an older API as none", async () => {
  const { api } = await signedIn(() => ({ body: accessPayload({ permissions: ["b2b.companies.view", "b2b.admin", "orders.view_all"] }) }));
  assert.deepEqual((await api.access()).permissions, ["b2b.companies.view"]);
  const older = await signedIn(() => ({ body: { application: "b2b", employee: { displayName: "E", username: "e", isRoot: false }, authorizationVersion: 1 } }));
  assert.deepEqual((await older.api.access()).permissions, []);
});

test("one user intent keeps one Idempotency-Key until it succeeds or its content changes", () => {
  const intent = new Intent();
  const first = intent.keyFor({ legalName: "A" });
  assert.match(first, /^[A-Za-z0-9][A-Za-z0-9_-]{15,99}$/);
  assert.equal(intent.keyFor({ legalName: "A" }), first, "a retry reuses the key");
  const changed = intent.keyFor({ legalName: "B" });
  assert.notEqual(changed, first, "different content is a new intent");
  intent.done();
  assert.notEqual(intent.keyFor({ legalName: "B" }), changed, "a completed intent never reuses its key");
  assert.notEqual(newIdempotencyKey(), newIdempotencyKey());
});

test("routes use Romanian paths and accept only server UUIDs", () => {
  assert.deepEqual(companiesRoute("/companii"), { kind: "list" });
  assert.deepEqual(companiesRoute("/companii/"), { kind: "list" });
  assert.deepEqual(companiesRoute("/companii/noua"), { kind: "create" });
  assert.deepEqual(companiesRoute(`/companii/${COMPANY_ID}`), { kind: "detail", id: COMPANY_ID });
  assert.equal(companiesRoute("/companii/B2B-000007"), null);
  assert.equal(companiesRoute("/"), null);
  assert.equal(companyPath(COMPANY_ID), `/companii/${COMPANY_ID}`);
});

test("form helpers trim, keep legal text, and validate neutrally", () => {
  const fields = companyFields({ ...emptyCompanyDraft(), legalName: "  S.C. Mobilă   Lux S.R.L. ", taxIdentifier: " RO 123 ", website: "  ", internalNotes: "Rând 1\nRând 2" });
  assert.equal(fields.legalName, "S.C. Mobilă   Lux S.R.L.");
  assert.equal(fields.taxIdentifier, "RO 123");
  assert.equal(fields.website, null);
  assert.equal(fields.internalNotes, "Rând 1\nRând 2");
  assert.deepEqual(checkCompany(companyFields(emptyCompanyDraft())), { legalName: "required", taxIdentifier: "required" });
  assert.deepEqual(checkCompany({ ...fields, countryCode: "XX" }), { countryCode: "invalid" });
  assert.deepEqual(checkContact(contactFields({ name: "", jobTitle: "", email: "nu-este-email", phone: "", isPrimary: false }), "contact."), { "contact.name": "required", "contact.email": "invalid" });
  assert.deepEqual(checkAddress({ type: "billing", label: null, countryCode: "RO", countyRegion: null, city: "", postalCode: null, addressLine1: "", addressLine2: null, isPrimary: false }), { city: "required", addressLine1: "required" });
  assert.deepEqual(differingFields({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, c: 4 }, ["a", "b"]), ["b"]);
});

test("countries come from the server list and are named in the interface language", () => {
  assert.equal(COUNTRY_CODES.length, 249);
  assert.equal(countryName("RO", "ro"), "România");
  assert.equal(countryName("TR", "ro"), "Turcia");
  assert.equal(countryName("RO", "tr"), "Romanya");
  const options = countryOptions("ro");
  assert.equal(options.frequent[0].code, "RO");
  assert.equal(options.frequent.length + options.others.length, 249);
});

const render = (locale: Locale, node: React.ReactNode) => text(renderToStaticMarkup(<I18nProvider locale={locale}>{node}</I18nProvider>));
const noApi = createApi(API, (() => new Promise(() => undefined)) as typeof fetch);

test("the list page explains a missing view permission and offers creation only when allowed", () => {
  const none = render("ro", <CompaniesPage api={noApi} canView={false} canCreate={false} navigate={() => undefined} />);
  assert.match(none, /Nu aveți permisiunea de a vedea companiile\./);
  assert.doesNotMatch(none, /Companie nouă/);
  const createOnly = render("ro", <CompaniesPage api={noApi} canView={false} canCreate navigate={() => undefined} />);
  assert.match(createOnly, /Companie nouă/);
  assert.match(createOnly, /Puteți înregistra companii noi/);
  const loading = render("tr", <CompaniesPage api={noApi} canView canCreate navigate={() => undefined} />);
  for (const label of ["Şirketler", "Arama", "Durum", "Ülke", "Yükleniyor…", "Yeni şirket"]) assert.ok(loading.includes(label), label);
  assert.doesNotMatch(loading, /Companii|Căutare/);
});

test("the create form asks only for legal name, country and tax identifier, in both languages", () => {
  const ro = renderToStaticMarkup(<I18nProvider locale="ro"><CompanyCreatePage api={noApi} canView navigate={() => undefined} onCreated={() => undefined} /></I18nProvider>);
  const required = [...ro.matchAll(/<label[^>]*>([^<]+)<span class="required"/g)].map((match) => match[1]);
  assert.deepEqual(required, ["Denumire legală", "Țară", "CUI / Cod fiscal"]);
  assert.match(text(ro), /Adaugă persoana de contact principală/);
  assert.match(text(ro), /Adaugă adresa principală/);
  const tr = render("tr", <CompanyCreatePage api={noApi} canView navigate={() => undefined} onCreated={() => undefined} />);
  for (const label of ["Yeni şirket", "Resmi unvan", "Vergi numarası", "KDV numarası", "Ticaret sicil numarası", "Dahili notlar", "Birincil iletişim kişisini ekle", "Şirketi oluştur"]) assert.ok(tr.includes(label), label);
});

test("every Companies text is centralized: no inline locale switches and no financial or risk wording", () => {
  const root = path.resolve(import.meta.dirname, "..", "src");
  const files = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
  for (const file of files(root).filter((candidate) => /\.(ts|tsx)$/.test(candidate))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /locale\s*===\s*["'](ro|tr)["']/, `${file} switches text inline`);
  }
  const all = JSON.stringify([MESSAGES.ro.companies, MESSAGES.tr.companies]).toLowerCase();
  for (const forbidden of ["rău platnic", "risc ridicat", "datorie", "sold", "credit limit", "kötü ödeyici", "yüksek risk", "borç", "bakiye"]) assert.ok(!all.includes(forbidden), forbidden);
  assert.equal(MESSAGES.ro.shell.modules.companies, "Companii");
  assert.equal(MESSAGES.tr.shell.modules.companies, "Şirketler");
  assert.equal(MESSAGES.ro.companies.fields.taxIdentifier, "CUI / Cod fiscal");
  assert.equal(MESSAGES.tr.companies.fields.taxIdentifier, "Vergi numarası");
});
