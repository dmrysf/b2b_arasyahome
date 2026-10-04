import { randomUUID } from "node:crypto";

/**
 * An in-memory double of the B2B Companies V1 endpoints (Operations API 2.8.0 shapes) for the browser smoke suite.
 * It mirrors the server rules the UI depends on: server-generated ids and codes, country + normalized tax id
 * uniqueness, expectedVersion checks, idempotent replays, primary rules and activity with field names only.
 */
type Row = Record<string, unknown> & { id: string; version: number; status: "active" | "inactive" };
type Company = Row & { code: string; legalName: string; displayName: string | null; countryCode: string; taxIdentifier: string; vatNumber: string | null; registrationNumber: string | null; website: string | null; internalNotes: string | null; statusChangedAt: string | null; createdAt: string; updatedAt: string; createdBy: { id: string; displayName: string }; updatedBy: { id: string; displayName: string } };
type Contact = Row & { name: string; jobTitle: string | null; email: string | null; phone: string | null; isPrimary: boolean; createdAt: string; updatedAt: string };
type Address = Row & { type: string; label: string | null; countryCode: string; countyRegion: string | null; city: string; postalCode: string | null; addressLine1: string; addressLine2: string | null; isPrimary: boolean; createdAt: string; updatedAt: string };
type Event = { id: string; action: string; subject: Record<string, unknown>; changedFields: string[]; actor: { id: string; displayName: string }; requestId: string; occurredAt: string };

export type Reply = { status: number; body: unknown };
const ACTOR = { id: "11111111-1111-4111-8111-111111111111", displayName: "Elena Vânzări" };
const COMPANY_FIELDS = ["legalName", "displayName", "countryCode", "taxIdentifier", "vatNumber", "registrationNumber", "website", "internalNotes"];
const CONTACT_FIELDS = ["name", "jobTitle", "email", "phone", "isPrimary"];
const ADDRESS_FIELDS = ["type", "label", "countryCode", "countyRegion", "city", "postalCode", "addressLine1", "addressLine2", "isPrimary"];

const error = (status: number, code: string, details?: unknown): Reply => ({ status, body: { error: { code, message: "English server text", requestId: "r", ...(details ? { details } : {}) } } });
const normalizeTax = (tax: string, country: string) => {
  const value = tax.toUpperCase().replace(/[\s./-]+/g, "");
  return value.startsWith(country) && /\d/.test(value[country.length] ?? "") ? value.slice(country.length) : value;
};

export function createCompanyStore(permissions: string[]) {
  let number = 0;
  let clock = Date.parse("2026-10-04T09:00:00Z");
  const now = () => new Date((clock += 60_000)).toISOString();
  const companies: Company[] = [];
  const contacts = new Map<string, Contact[]>();
  const addresses = new Map<string, Address[]>();
  const activity = new Map<string, Event[]>();
  const replays = new Map<string, { hash: string; reply: Reply }>();
  const can = (permission: string) => permissions.includes(permission);
  const capabilities = () => ({ canView: can("b2b.companies.view"), canCreate: can("b2b.companies.create"), canUpdate: can("b2b.companies.update"), canManageStatus: can("b2b.companies.manage_status") });

  const event = (companyId: string, action: string, subject: Record<string, unknown>, changedFields: string[]) => {
    activity.get(companyId)?.unshift({ id: randomUUID(), action, subject, changedFields, actor: ACTOR, requestId: `req-${randomUUID().slice(0, 8)}`, occurredAt: now() });
  };
  const detail = (company: Company) => ({ company, contacts: contacts.get(company.id) ?? [], addresses: addresses.get(company.id) ?? [], capabilities: capabilities() });
  const answer = (status: number, companyId: string, extra: Record<string, string> = {}): Reply => {
    const company = companies.find((candidate) => candidate.id === companyId) as Company;
    return { status, body: { companyId, ...extra, ...(can("b2b.companies.view") ? detail(company) : {}) } };
  };
  const validateCompany = (input: Record<string, unknown>) => {
    const fields: Record<string, string> = {};
    if (!String(input.legalName ?? "").trim()) fields.legalName = "required";
    if (!/^[A-Z]{2}$/.test(String(input.countryCode ?? ""))) fields.countryCode = "invalid";
    if (!String(input.taxIdentifier ?? "").trim()) fields.taxIdentifier = "required";
    if (input.website && !/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}/i.test(String(input.website))) fields.website = "invalid";
    return fields;
  };
  const duplicateOf = (country: string, tax: string, except?: string) => companies.find((company) => company.id !== except && company.countryCode === country && normalizeTax(company.taxIdentifier, country) === normalizeTax(tax, country));

  const insertContact = (companyId: string, input: Record<string, unknown>) => {
    const list = contacts.get(companyId) ?? [];
    if (input.isPrimary) list.filter((contact) => contact.isPrimary).forEach((contact) => { contact.isPrimary = false; contact.version += 1; event(companyId, "contact_updated", { type: "contact", id: contact.id, name: contact.name }, ["isPrimary"]); });
    const at = now();
    const contact: Contact = { id: randomUUID(), name: String(input.name), jobTitle: (input.jobTitle as string) ?? null, email: input.email ? String(input.email).toLowerCase() : null, phone: (input.phone as string) ?? null, isPrimary: Boolean(input.isPrimary), status: "active", createdAt: at, updatedAt: at, version: 1 };
    list.push(contact);
    contacts.set(companyId, list);
    event(companyId, "contact_created", { type: "contact", id: contact.id, name: contact.name }, CONTACT_FIELDS.filter((field) => input[field]));
    return contact.id;
  };
  const insertAddress = (companyId: string, input: Record<string, unknown>) => {
    const list = addresses.get(companyId) ?? [];
    if (input.isPrimary) list.filter((address) => address.isPrimary && address.type === input.type).forEach((address) => { address.isPrimary = false; address.version += 1; });
    const at = now();
    const address: Address = { id: randomUUID(), type: String(input.type), label: (input.label as string) ?? null, countryCode: String(input.countryCode), countyRegion: (input.countyRegion as string) ?? null, city: String(input.city), postalCode: (input.postalCode as string) ?? null, addressLine1: String(input.addressLine1), addressLine2: (input.addressLine2 as string) ?? null, isPrimary: Boolean(input.isPrimary), status: "active", createdAt: at, updatedAt: at, version: 1 };
    list.push(address);
    addresses.set(companyId, list);
    event(companyId, "address_created", { type: "address", id: address.id, addressType: address.type, label: address.label, city: address.city }, ADDRESS_FIELDS.filter((field) => input[field]));
    return address.id;
  };
  const createCompany = (input: Record<string, unknown>): Reply => {
    const fields = validateCompany(input);
    if (Object.keys(fields).length) return error(422, "VALIDATION_FAILED", { fields });
    const existing = duplicateOf(String(input.countryCode), String(input.taxIdentifier));
    if (existing) return error(409, "COMPANY_TAX_ID_ALREADY_EXISTS", can("b2b.companies.view") ? { company: { id: existing.id, code: existing.code } } : undefined);
    number += 1;
    const at = now();
    const website = input.website ? (/^https?:\/\//.test(String(input.website)) ? String(input.website) : `https://${String(input.website)}`) : null;
    const company: Company = {
      id: randomUUID(), code: `B2B-${String(number).padStart(6, "0")}`, legalName: String(input.legalName).trim(), displayName: (input.displayName as string) ?? null,
      countryCode: String(input.countryCode), taxIdentifier: String(input.taxIdentifier).trim(), vatNumber: (input.vatNumber as string) ?? null, registrationNumber: (input.registrationNumber as string) ?? null,
      website, internalNotes: (input.internalNotes as string) ?? null, status: "active", statusChangedAt: null, createdAt: at, updatedAt: at, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    };
    companies.push(company);
    activity.set(company.id, []);
    event(company.id, "company_created", { type: "company", id: company.id }, COMPANY_FIELDS.filter((field) => input[field]));
    const extra: Record<string, string> = {};
    if (input.contact) extra.contactId = insertContact(company.id, input.contact as Record<string, unknown>);
    if (input.address) extra.addressId = insertAddress(company.id, input.address as Record<string, unknown>);
    return answer(201, company.id, extra);
  };

  /** Seeds a company without going through HTTP (for list, search and pagination scenarios). */
  const seed = (input: Record<string, unknown>) => (createCompany({ countryCode: "RO", ...input }).body as { companyId: string }).companyId;

  /** Simulates another employee saving the company first. */
  const externalEdit = (companyId: string, changes: Record<string, unknown>) => {
    const company = companies.find((candidate) => candidate.id === companyId) as Company;
    Object.assign(company, changes, { version: company.version + 1, updatedAt: now(), updatedBy: { id: "22222222-2222-4222-8222-222222222222", displayName: "Andrei Coleg" } });
    event(companyId, "company_updated", { type: "company", id: companyId }, Object.keys(changes));
  };

  const handle = (method: string, path: string, query: URLSearchParams, input: Record<string, unknown>, key: string | undefined): Reply => {
    const parts = path.split("/").filter(Boolean).slice(2); // after /b2b/companies
    const [companyId, section, childId, childAction] = parts;
    if (method === "GET") {
      if (!can("b2b.companies.view")) return error(403, "UNAUTHORIZED_ACTION");
      if (!companyId) {
        const status = query.get("status") ?? "active";
        const country = query.get("country") ?? "";
        const search = (query.get("search") ?? "").toLowerCase();
        const limit = Number(query.get("limit") ?? 50);
        const filtered = companies
          .filter((company) => status === "all" || company.status === status)
          .filter((company) => !country || company.countryCode === country)
          .filter((company) => !search || company.code.toLowerCase().includes(search) || company.legalName.toLowerCase().includes(search) || (company.displayName ?? "").toLowerCase().includes(search)
            || normalizeTax(company.taxIdentifier, company.countryCode).toLowerCase().startsWith(search.replace(/[^a-z0-9]/g, ""))
            || (addresses.get(company.id) ?? []).some((address) => address.city.toLowerCase().startsWith(search)))
          .sort((a, b) => a.legalName.localeCompare(b.legalName) || a.id.localeCompare(b.id));
        const start = query.get("cursor") ? Number(query.get("cursor")) : 0;
        const page = filtered.slice(start, start + limit);
        return {
          status: 200,
          body: {
            items: page.map((company) => ({
              id: company.id, code: company.code, legalName: company.legalName, displayName: company.displayName, countryCode: company.countryCode, taxIdentifier: company.taxIdentifier,
              city: (addresses.get(company.id) ?? []).find((address) => address.status === "active")?.city ?? null,
              primaryContact: ((contact) => (contact ? { name: contact.name } : null))((contacts.get(company.id) ?? []).find((candidate) => candidate.isPrimary)),
              status: company.status, updatedAt: company.updatedAt,
            })),
            nextCursor: start + limit < filtered.length ? String(start + limit) : null,
            capabilities: capabilities(),
          },
        };
      }
      const company = companies.find((candidate) => candidate.id === companyId);
      if (!company) return error(404, "COMPANY_NOT_FOUND");
      if (section === "activity") return { status: 200, body: { items: activity.get(company.id) ?? [], nextCursor: null } };
      return { status: 200, body: detail(company) };
    }

    const replayKey = `${key}`;
    const hash = JSON.stringify({ method, path, input });
    const previous = replays.get(replayKey);
    if (previous) return previous.hash === hash ? previous.reply : error(409, "IDEMPOTENCY_CONFLICT");
    const reply = mutate();
    if (reply.status < 400) replays.set(replayKey, { hash, reply });
    return reply;

    function mutate(): Reply {
      if (method === "POST" && !companyId) return can("b2b.companies.create") ? createCompany(input) : error(403, "UNAUTHORIZED_ACTION");
      const company = companies.find((candidate) => candidate.id === companyId);
      if (!company) return error(404, "COMPANY_NOT_FOUND");
      if (method === "PUT" && !section) {
        if (!can("b2b.companies.update")) return error(403, "UNAUTHORIZED_ACTION");
        if (input.expectedVersion !== company.version) return error(409, "COMPANY_CHANGED");
        const fields = validateCompany(input);
        if (Object.keys(fields).length) return error(422, "VALIDATION_FAILED", { fields });
        const existing = duplicateOf(String(input.countryCode), String(input.taxIdentifier), company.id);
        if (existing) return error(409, "COMPANY_TAX_ID_ALREADY_EXISTS", { company: { id: existing.id, code: existing.code } });
        const changed = COMPANY_FIELDS.filter((field) => company[field] !== input[field]);
        if (changed.length) {
          COMPANY_FIELDS.forEach((field) => { company[field] = input[field] ?? null; });
          Object.assign(company, { version: company.version + 1, updatedAt: now(), updatedBy: ACTOR });
          event(company.id, "company_updated", { type: "company", id: company.id }, changed);
        }
        return answer(200, company.id);
      }
      if (method === "POST" && (section === "deactivate" || section === "reactivate")) {
        if (!can("b2b.companies.manage_status")) return error(403, "UNAUTHORIZED_ACTION");
        if (input.expectedVersion !== company.version) return error(409, "COMPANY_CHANGED");
        const status = section === "reactivate" ? "active" : "inactive";
        if (company.status === status) return error(409, "STATUS_UNCHANGED");
        Object.assign(company, { status, statusChangedAt: now(), version: company.version + 1, updatedAt: now(), updatedBy: ACTOR });
        event(company.id, `company_${section}d`, { type: "company", id: company.id }, ["status"]);
        return answer(200, company.id);
      }
      if (!can("b2b.companies.update")) return error(403, "UNAUTHORIZED_ACTION");
      if (section === "contacts" || section === "addresses") {
        const kind = section === "contacts" ? "contact" : "address";
        const store = (section === "contacts" ? contacts : addresses) as Map<string, Array<Contact | Address>>;
        if (method === "POST" && !childId) {
          if (kind === "contact" && !String(input.name ?? "").trim()) return error(422, "VALIDATION_FAILED", { fields: { name: "required" } });
          if (kind === "contact" && input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email))) return error(422, "VALIDATION_FAILED", { fields: { email: "invalid" } });
          const id = kind === "contact" ? insertContact(company.id, input) : insertAddress(company.id, input);
          return answer(201, company.id, { [`${kind}Id`]: id });
        }
        const record = (store.get(company.id) ?? []).find((candidate) => candidate.id === childId);
        if (!record) return error(404, kind === "contact" ? "CONTACT_NOT_FOUND" : "ADDRESS_NOT_FOUND");
        if (input.expectedVersion !== record.version) return error(409, kind === "contact" ? "CONTACT_CHANGED" : "ADDRESS_CHANGED");
        const subject = kind === "contact" ? { type: "contact", id: record.id, name: (record as Contact).name } : { type: "address", id: record.id, addressType: (record as Address).type, label: (record as Address).label, city: (record as Address).city };
        if (method === "POST" && childAction) {
          const status = childAction === "reactivate" ? "active" : "inactive";
          if (record.status === status) return error(409, "STATUS_UNCHANGED");
          const wasPrimary = record.isPrimary;
          Object.assign(record, { status, isPrimary: false, version: record.version + 1, updatedAt: now() });
          event(company.id, `${kind}_${childAction}d`, subject, status === "inactive" && wasPrimary ? ["status", "isPrimary"] : ["status"]);
          return answer(200, company.id);
        }
        if (method === "PUT") {
          const fields = kind === "contact" ? CONTACT_FIELDS : ADDRESS_FIELDS;
          const changed = fields.filter((field) => record[field] !== input[field]);
          if (input.isPrimary) {
            (store.get(company.id) ?? []).filter((other) => other.id !== record.id && other.isPrimary && (kind === "contact" || (other as Address).type === input.type)).forEach((other) => { other.isPrimary = false; other.version += 1; });
          }
          if (changed.length) {
            fields.forEach((field) => { record[field] = input[field] ?? null; });
            Object.assign(record, { version: record.version + 1, updatedAt: now() });
            event(company.id, `${kind}_updated`, subject, changed);
          }
          return answer(200, company.id);
        }
      }
      return error(405, "METHOD_NOT_ALLOWED");
    }
  };

  return { handle, seed, externalEdit, companies, contacts, addresses, activity };
}
