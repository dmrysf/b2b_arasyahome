import { ApiError } from "./errors";

/** B2B Companies V1 contract (Operations API 2.8.0). Identifiers are server-generated; the browser never makes them. */
export const COMPANY_PERMISSIONS = ["b2b.companies.view", "b2b.companies.create", "b2b.companies.update", "b2b.companies.manage_status"] as const;
export type CompanyPermission = (typeof COMPANY_PERMISSIONS)[number];

export const ADDRESS_TYPES = ["billing", "delivery", "office", "other"] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];
export type RecordStatus = "active" | "inactive";
export type StatusFilter = RecordStatus | "all";

export type Capabilities = { canView: boolean; canCreate: boolean; canUpdate: boolean; canManageStatus: boolean };

export type CompanyListItem = {
  id: string;
  code: string;
  legalName: string;
  displayName: string | null;
  countryCode: string;
  taxIdentifier: string;
  city: string | null;
  primaryContact: { name: string } | null;
  status: RecordStatus;
  updatedAt: string;
};

export type CompanyList = { items: CompanyListItem[]; nextCursor: string | null; capabilities: Capabilities };

export type Company = {
  id: string;
  code: string;
  legalName: string;
  displayName: string | null;
  countryCode: string;
  taxIdentifier: string;
  vatNumber: string | null;
  registrationNumber: string | null;
  website: string | null;
  internalNotes: string | null;
  status: RecordStatus;
  statusChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; displayName: string };
  updatedBy: { id: string; displayName: string };
  version: number;
};

export type Contact = {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Address = {
  id: string;
  type: AddressType;
  label: string | null;
  countryCode: string;
  countyRegion: string | null;
  city: string;
  postalCode: string | null;
  addressLine1: string;
  addressLine2: string | null;
  isPrimary: boolean;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CompanyDetail = { company: Company; contacts: Contact[]; addresses: Address[]; capabilities: Capabilities };

/** A mutation answer: the ids it produced and, for a viewer, the current detail. */
export type CompanyMutation = { companyId: string; contactId?: string; addressId?: string; detail: CompanyDetail | null };

export type ActivityAction =
  | "company_created" | "company_updated" | "company_deactivated" | "company_reactivated"
  | "contact_created" | "contact_updated" | "contact_deactivated" | "contact_reactivated"
  | "address_created" | "address_updated" | "address_deactivated" | "address_reactivated";

export type ActivityEvent = {
  id: string;
  action: ActivityAction | string;
  subject: { type: "company" | "contact" | "address" | string; id: string; name?: string | null; addressType?: string | null; label?: string | null; city?: string | null };
  changedFields: string[];
  actor: { id: string; displayName: string };
  requestId: string;
  occurredAt: string;
};

export type ActivityPage = { items: ActivityEvent[]; nextCursor: string | null };

export type CompanyFields = {
  legalName: string;
  displayName: string | null;
  countryCode: string;
  taxIdentifier: string;
  vatNumber: string | null;
  registrationNumber: string | null;
  website: string | null;
  internalNotes: string | null;
};
export type ContactFields = { name: string; jobTitle: string | null; email: string | null; phone: string | null; isPrimary: boolean };
export type AddressFields = {
  type: AddressType;
  label: string | null;
  countryCode: string;
  countyRegion: string | null;
  city: string;
  postalCode: string | null;
  addressLine1: string;
  addressLine2: string | null;
  isPrimary: boolean;
};

const invalid = () => new ApiError("INVALID_RESPONSE", 502);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function str(raw: Record<string, unknown>, field: string): string {
  const value = raw[field];
  if (typeof value !== "string") throw invalid();
  return value;
}
function nullable(raw: Record<string, unknown>, field: string): string | null {
  const value = raw[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalid();
  return value;
}
function status(raw: Record<string, unknown>): RecordStatus {
  const value = raw.status;
  if (value !== "active" && value !== "inactive") throw invalid();
  return value;
}
function int(raw: Record<string, unknown>, field: string): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isInteger(value)) throw invalid();
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw invalid();
  return value;
}
function person(value: unknown): { id: string; displayName: string } {
  const raw = object(value);
  return { id: str(raw, "id"), displayName: str(raw, "displayName") };
}

export function mapCapabilities(value: unknown): Capabilities {
  const raw = object(value);
  const flag = (field: string) => { if (typeof raw[field] !== "boolean") throw invalid(); return raw[field] as boolean; };
  return { canView: flag("canView"), canCreate: flag("canCreate"), canUpdate: flag("canUpdate"), canManageStatus: flag("canManageStatus") };
}

export function mapCompanyList(value: unknown): CompanyList {
  const raw = object(value);
  return {
    items: list(raw.items).map((entry) => {
      const item = object(entry);
      const contact = item.primaryContact === null ? null : { name: str(object(item.primaryContact), "name") };
      return {
        id: str(item, "id"), code: str(item, "code"), legalName: str(item, "legalName"), displayName: nullable(item, "displayName"),
        countryCode: str(item, "countryCode"), taxIdentifier: str(item, "taxIdentifier"), city: nullable(item, "city"),
        primaryContact: contact, status: status(item), updatedAt: str(item, "updatedAt"),
      };
    }),
    nextCursor: nullable(raw, "nextCursor"),
    capabilities: mapCapabilities(raw.capabilities),
  };
}

function mapCompany(value: unknown): Company {
  const raw = object(value);
  return {
    id: str(raw, "id"), code: str(raw, "code"), legalName: str(raw, "legalName"), displayName: nullable(raw, "displayName"),
    countryCode: str(raw, "countryCode"), taxIdentifier: str(raw, "taxIdentifier"), vatNumber: nullable(raw, "vatNumber"),
    registrationNumber: nullable(raw, "registrationNumber"), website: nullable(raw, "website"), internalNotes: nullable(raw, "internalNotes"),
    status: status(raw), statusChangedAt: nullable(raw, "statusChangedAt"), createdAt: str(raw, "createdAt"), updatedAt: str(raw, "updatedAt"),
    createdBy: person(raw.createdBy), updatedBy: person(raw.updatedBy), version: int(raw, "version"),
  };
}

function mapContact(value: unknown): Contact {
  const raw = object(value);
  if (typeof raw.isPrimary !== "boolean") throw invalid();
  return {
    id: str(raw, "id"), name: str(raw, "name"), jobTitle: nullable(raw, "jobTitle"), email: nullable(raw, "email"), phone: nullable(raw, "phone"),
    isPrimary: raw.isPrimary, status: status(raw), createdAt: str(raw, "createdAt"), updatedAt: str(raw, "updatedAt"), version: int(raw, "version"),
  };
}

function mapAddress(value: unknown): Address {
  const raw = object(value);
  const type = raw.type;
  if (typeof raw.isPrimary !== "boolean" || !ADDRESS_TYPES.includes(type as AddressType)) throw invalid();
  return {
    id: str(raw, "id"), type: type as AddressType, label: nullable(raw, "label"), countryCode: str(raw, "countryCode"), countyRegion: nullable(raw, "countyRegion"),
    city: str(raw, "city"), postalCode: nullable(raw, "postalCode"), addressLine1: str(raw, "addressLine1"), addressLine2: nullable(raw, "addressLine2"),
    isPrimary: raw.isPrimary, status: status(raw), createdAt: str(raw, "createdAt"), updatedAt: str(raw, "updatedAt"), version: int(raw, "version"),
  };
}

export function mapCompanyDetail(value: unknown): CompanyDetail {
  const raw = object(value);
  return { company: mapCompany(raw.company), contacts: list(raw.contacts).map(mapContact), addresses: list(raw.addresses).map(mapAddress), capabilities: mapCapabilities(raw.capabilities) };
}

export function mapMutation(value: unknown): CompanyMutation {
  const raw = object(value);
  const result: CompanyMutation = { companyId: str(raw, "companyId"), detail: raw.company === undefined ? null : mapCompanyDetail(raw) };
  if (typeof raw.contactId === "string") result.contactId = raw.contactId;
  if (typeof raw.addressId === "string") result.addressId = raw.addressId;
  return result;
}

export function mapActivity(value: unknown): ActivityPage {
  const raw = object(value);
  return {
    items: list(raw.items).map((entry) => {
      const item = object(entry);
      const subject = object(item.subject);
      const fields = list(item.changedFields);
      if (fields.some((field) => typeof field !== "string")) throw invalid();
      return {
        id: str(item, "id"), action: str(item, "action"),
        subject: { type: str(subject, "type"), id: str(subject, "id"), name: nullable(subject, "name"), addressType: nullable(subject, "addressType"), label: nullable(subject, "label"), city: nullable(subject, "city") },
        changedFields: fields as string[], actor: person(item.actor), requestId: str(item, "requestId"), occurredAt: str(item, "occurredAt"),
      };
    }),
    nextCursor: nullable(raw, "nextCursor"),
  };
}
