import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { mapAccountMutation, mapAccountSummary, mapMovement, mapStatement } from "../src/api/accounts";
import { ApiError, createApi } from "../src/api/client";
import { AccountsPage } from "../src/accounts/AccountsPage";
import { accountsRo, accountsTr } from "../src/accounts/messages";
import {
  absolute, accountPath, accountsRoute, balanceKind, businessToday, formatMoney, fromCents, isBusinessDate, normalizeAmount, statementFilename, toCents,
} from "../src/accounts/model";
import { MESSAGES } from "../src/i18n";
import { I18nProvider } from "../src/i18n/context";
import { accessPayload, API, apiError, fakeFetch, sessionPayload, text } from "./support";

const company = { id: "22222222-2222-4222-8222-222222222222", code: "B2B-000001", legalName: "Ţesături SRL", displayName: null, countryCode: "RO", taxIdentifier: "RO123", vatNumber: null, registrationNumber: null, status: "active" };
const currency = (balance: string) => ({ balance, debits: "160.65", credits: "0.00", outstandingReceivables: "160.65", unallocatedPayments: "0.00", activeOpeningBalance: false, movementCount: 1 });
const caps = { canView: true, canRecordPayment: true, canAdjust: false, canReverse: false, canExport: true };
const summary = { company, currencies: { RON: currency("160.65"), EUR: currency("-5.00") }, capabilities: { ...caps, companyActive: true } };
const movement = {
  id: "33333333-3333-4333-8333-333333333333", code: "B2B-MV-000001", type: "order_receivable", direction: "debit", amount: "160.65", currencyCode: "RON", valueDate: "2026-10-05",
  orderId: "44444444-4444-4444-8444-444444444444", orderCode: "B2B-ORD-000001", method: null, externalReference: null, note: null, reasonCode: null, reverses: null, reversedBy: null,
  allocated: "0.00", open: "160.65", createdAt: "2026-10-05T08:00:00.000Z", createdBy: { id: "x", displayName: "Ana" },
};

test("money stays exact text and integer cents; floats and malformed amounts never pass", () => {
  assert.equal(normalizeAmount("12"), "12.00");
  assert.equal(normalizeAmount(" 12,5 "), "12.50");
  assert.equal(normalizeAmount("0012.30"), "12.30");
  assert.equal(normalizeAmount("9999999999.99"), "9999999999.99");
  for (const bad of ["0", "0.00", "-1", "1.001", "1e3", "1 000", "abc", "", "12345678901"]) assert.equal(normalizeAmount(bad), null, bad);
  assert.equal(toCents("-160.65"), -16065n);
  assert.equal(fromCents(toCents("0.10") + toCents("0.20")), "0.30");
  assert.equal(fromCents(-5n), "-0.05");
  assert.equal(toCents("99999999999999.99"), 9999999999999999n, "beyond Number precision stays exact");
  assert.equal(formatMoney("1234567.80", "ro", "RON"), "1.234.567,80 RON");
  assert.equal(formatMoney("-5.00", "tr"), "−5,00");
  assert.deepEqual(["10.00", "-0.01", "0.00"].map(balanceKind), ["owes", "credit", "settled"]);
  assert.equal(absolute("-12.00"), "12.00");
});

test("business dates follow the Bucharest calendar and never lie in the future", () => {
  assert.equal(businessToday(new Date("2026-10-04T21:30:00Z")), "2026-10-05");
  assert.equal(isBusinessDate("2026-10-05", "2026-10-05"), true);
  assert.equal(isBusinessDate("2026-10-06", "2026-10-05"), false);
  assert.equal(isBusinessDate("2026-02-30", "2026-10-05"), false);
  assert.equal(isBusinessDate("1999-12-31", "2026-10-05"), false);
});

test("routes and statement file names", () => {
  assert.deepEqual(accountsRoute("/conturi-curente"), { kind: "list" });
  assert.deepEqual(accountsRoute(accountPath(company.id)), { kind: "company", id: company.id });
  assert.equal(accountsRoute("/conturi-curente/not-a-uuid"), null);
  assert.equal(accountsRoute("/companii"), null);
  assert.equal(statementFilename("B2B-000001", "RON", "2026-10-05", "pdf"), "extras-B2B-000001-RON-2026-10-05.pdf");
});

test("account responses are mapped strictly; numeric or malformed money fails closed", () => {
  assert.equal(mapAccountSummary(summary).currencies.EUR.balance, "-5.00");
  assert.equal(mapMovement(movement).orderCode, "B2B-ORD-000001");
  for (const broken of [{ ...movement, amount: 160.65 }, { ...movement, amount: "160.6" }, { ...movement, type: "invoice" }, { ...movement, method: "cheque" }, { ...movement, valueDate: "05.10.2026" }]) {
    assert.throws(() => mapMovement(broken), (error: unknown) => error instanceof ApiError && error.code === "INVALID_RESPONSE");
  }
  assert.throws(() => mapAccountSummary({ ...summary, currencies: { RON: currency("1.00") } }), ApiError, "both currencies are required");
  assert.equal(mapAccountMutation({ companyId: company.id, movementId: movement.id, allocationIds: [], summary: null }).summary, null);
  const statement = mapStatement({ company, currencyCode: "RON", from: null, to: "2026-10-05", openingBalance: "0.00", totals: { debit: "160.65", credit: "0.00" }, closingBalance: "160.65", generatedAt: "2026-10-05T08:00:00Z",
    movements: [{ id: "m", code: "B2B-MV-000001", valueDate: "2026-10-05", type: "order_receivable", direction: "debit", orderCode: "B2B-ORD-000001", method: null, externalReference: null, reasonCode: null, reversesCode: null, reversedByCode: null, debit: "160.65", credit: null, runningBalance: "160.65", createdAt: "x", createdBy: "Ana" }] });
  assert.equal(statement.closingBalance, "160.65");
});

test("account mutations carry CSRF and an Idempotency-Key and send exact decimal strings", async () => {
  const { fetchImpl, calls } = fakeFetch((call) => {
    if (call.url.pathname === "/auth/session") return { body: sessionPayload({}, "csrf-acc") };
    return { status: 201, body: { companyId: company.id, movementId: movement.id, allocationIds: ["a1"], summary } };
  });
  const api = createApi(API, fetchImpl);
  await api.getSession();
  const body = { currencyCode: "RON" as const, amount: "200.00", valueDate: "2026-10-05", method: "bank_transfer" as const, externalReference: "OP-1", note: null, allocations: [{ receivableId: movement.id, amount: "160.65" }] };
  const result = await api.recordPayment(company.id, body, { idempotencyKey: "payment-key-0000001" });
  await api.reverseMovement(company.id, movement.id, { valueDate: "2026-10-05", reason: "bounced" }, { idempotencyKey: "reverse-key-0000001" });
  await api.releaseAllocation(company.id, "a1", "wrong order", { idempotencyKey: "release-key-0000001" });
  await api.postAdjustment(company.id, { currencyCode: "EUR", direction: "credit", amount: "5.00", valueDate: "2026-10-05", reason: "goodwill" }, { idempotencyKey: "adjust-key-00000001" });
  assert.equal(result.summary?.currencies.RON.balance, "160.65");
  assert.deepEqual(calls.slice(1).map((call) => `${call.method} ${call.url.pathname}`), [
    `POST /b2b/accounts/${company.id}/payments`, `POST /b2b/accounts/${company.id}/movements/${movement.id}/reverse`,
    `POST /b2b/accounts/${company.id}/allocations/a1/release`, `POST /b2b/accounts/${company.id}/adjustments`,
  ]);
  for (const call of calls.slice(1)) {
    assert.equal(call.headers["X-CSRF-Token"], "csrf-acc");
    assert.match(call.headers["Idempotency-Key"], /^[a-z]+-key-\d+$/);
  }
  assert.deepEqual(calls[1].body, body);
  assert.equal(typeof (calls[1].body as { amount: unknown }).amount, "string");
});

test("statement files are downloaded as server bytes; failures are typed errors", async () => {
  const pdf = "%PDF-1.4 bytes";
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith(".pdf")) return new Response(pdf, { status: 200, headers: { "Content-Type": "application/pdf" } });
    return new Response(JSON.stringify(apiError("UNAUTHORIZED_ACTION", 403).body), { status: 403, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const api = createApi(API, fetchImpl);
  const blob = await api.accountStatementFile(company.id, "pdf", { currency: "RON", from: "2026-01-01", lang: "tr" });
  assert.equal(await blob.text(), pdf);
  await assert.rejects(api.accountStatementFile(company.id, "csv", { currency: "EUR", lang: "ro" }), (error: unknown) => error instanceof ApiError && error.code === "UNAUTHORIZED_ACTION");
  assert.deepEqual(calls, [`/b2b/accounts/${company.id}/statement.pdf?currency=RON&from=2026-01-01&lang=tr`, `/b2b/accounts/${company.id}/statement.csv?currency=EUR&lang=ro`]);
});

test("the B2B gate keeps known account permissions and drops unknown ones", async () => {
  const { fetchImpl } = fakeFetch(() => ({ body: accessPayload({ permissions: ["b2b.accounts.view", "b2b.accounts.export", "b2b.accounts.delete", "finance.view"] }) }));
  assert.deepEqual((await createApi(API, fetchImpl).access()).permissions, ["b2b.accounts.view", "b2b.accounts.export"]);
});

test("account text exists in Romanian and Turkish, including every account error code", () => {
  const keys = (value: object): string[] => Object.entries(value).flatMap(([key, child]) => (child && typeof child === "object" ? keys(child).map((sub) => `${key}.${sub}`) : [key])).sort();
  assert.deepEqual(keys(accountsTr), keys(accountsRo));
  for (const code of ["PAYMENT_NOT_FOUND", "RECEIVABLE_NOT_FOUND", "MOVEMENT_NOT_FOUND", "ALLOCATION_NOT_FOUND", "MOVEMENT_REVERSED", "ALLOCATION_EXCEEDS_PAYMENT", "ALLOCATION_EXCEEDS_OUTSTANDING",
    "CURRENCY_MISMATCH", "ALLOCATION_ALREADY_RELEASED", "OPENING_BALANCE_EXISTS", "REVERSAL_NOT_REVERSIBLE", "ORDER_RECEIVABLE_FOLLOWS_ORDER", "MOVEMENT_ALREADY_REVERSED", "STATEMENT_TOO_LARGE", "COMPANY_INACTIVE"]) {
    assert.ok(Object.hasOwn(MESSAGES.ro.errors, code) && Object.hasOwn(MESSAGES.tr.errors, code), code);
  }
  assert.equal(MESSAGES.tr.shell.modules.accounts, "Cari hesaplar");
  assert.equal(accountsRo.movementCount(1), "1 mișcare");
  assert.equal(accountsRo.movementCount(20), "20 de mișcări");
});

test("without view permission the accounts page explains it and requests nothing", () => {
  let requested = false;
  const api = createApi(API, (async () => { requested = true; return new Response("{}"); }) as typeof fetch);
  const html = text(renderToStaticMarkup(<I18nProvider locale="ro"><AccountsPage api={api} canView={false} navigate={() => undefined} /></I18nProvider>));
  assert.match(html, /Nu aveți permisiunea de a vedea conturile curente\./);
  assert.equal(requested, false);
});
