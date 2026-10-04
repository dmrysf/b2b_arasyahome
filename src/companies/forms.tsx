import { useId, type ReactNode } from "react";
import {
  ADDRESS_TYPES, type Address, type AddressFields, type AddressType, type Company, type CompanyFields, type Contact, type ContactFields,
} from "../api/companies";
import { ApiError } from "../api/errors";
import { useI18n } from "../i18n/context";
import { COUNTRY_CODES, countryOptions } from "./countries";

/** Form drafts hold exactly what the employee typed; normalization is the server's job. */
export type CompanyDraft = Record<keyof CompanyFields, string>;
export type ContactDraft = { name: string; jobTitle: string; email: string; phone: string; isPrimary: boolean };
export type AddressDraft = Omit<Record<keyof AddressFields, string>, "isPrimary" | "type"> & { type: AddressType; isPrimary: boolean };
export type FieldErrors = Record<string, string>;

export const COMPANY_FIELD_ORDER: Array<keyof CompanyFields> = ["legalName", "displayName", "countryCode", "taxIdentifier", "vatNumber", "registrationNumber", "website", "internalNotes"];
export const CONTACT_FIELD_ORDER: Array<keyof ContactFields> = ["name", "jobTitle", "email", "phone", "isPrimary"];
export const ADDRESS_FIELD_ORDER: Array<keyof AddressFields> = ["type", "label", "countryCode", "countyRegion", "city", "postalCode", "addressLine1", "addressLine2", "isPrimary"];

const optional = (value: string): string | null => (value.trim() === "" ? null : value.trim());

export const emptyCompanyDraft = (): CompanyDraft => ({ legalName: "", displayName: "", countryCode: "RO", taxIdentifier: "", vatNumber: "", registrationNumber: "", website: "", internalNotes: "" });
export const emptyContactDraft = (isPrimary = false): ContactDraft => ({ name: "", jobTitle: "", email: "", phone: "", isPrimary });
export const emptyAddressDraft = (countryCode = "RO", isPrimary = false): AddressDraft => ({ type: "billing", label: "", countryCode, countyRegion: "", city: "", postalCode: "", addressLine1: "", addressLine2: "", isPrimary });

export function companyDraft(company: Company): CompanyDraft {
  return {
    legalName: company.legalName, displayName: company.displayName ?? "", countryCode: company.countryCode, taxIdentifier: company.taxIdentifier,
    vatNumber: company.vatNumber ?? "", registrationNumber: company.registrationNumber ?? "", website: company.website ?? "", internalNotes: company.internalNotes ?? "",
  };
}
export function contactDraft(contact: Contact): ContactDraft {
  return { name: contact.name, jobTitle: contact.jobTitle ?? "", email: contact.email ?? "", phone: contact.phone ?? "", isPrimary: contact.isPrimary };
}
export function addressDraft(address: Address): AddressDraft {
  return {
    type: address.type, label: address.label ?? "", countryCode: address.countryCode, countyRegion: address.countyRegion ?? "", city: address.city,
    postalCode: address.postalCode ?? "", addressLine1: address.addressLine1, addressLine2: address.addressLine2 ?? "", isPrimary: address.isPrimary,
  };
}

export function companyFields(draft: CompanyDraft): CompanyFields {
  return {
    legalName: draft.legalName.trim(), displayName: optional(draft.displayName), countryCode: draft.countryCode, taxIdentifier: draft.taxIdentifier.trim(),
    vatNumber: optional(draft.vatNumber), registrationNumber: optional(draft.registrationNumber), website: optional(draft.website),
    internalNotes: draft.internalNotes.trim() === "" ? null : draft.internalNotes,
  };
}
export function contactFields(draft: ContactDraft): ContactFields {
  return { name: draft.name.trim(), jobTitle: optional(draft.jobTitle), email: optional(draft.email), phone: optional(draft.phone), isPrimary: draft.isPrimary };
}
export function addressFields(draft: AddressDraft): AddressFields {
  return {
    type: draft.type, label: optional(draft.label), countryCode: draft.countryCode, countyRegion: optional(draft.countyRegion), city: draft.city.trim(),
    postalCode: optional(draft.postalCode), addressLine1: draft.addressLine1.trim(), addressLine2: optional(draft.addressLine2), isPrimary: draft.isPrimary,
  };
}

/** Quick neutral checks before sending; the server validates everything again and its answer wins. */
export function checkCompany(fields: CompanyFields, prefix = ""): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.legalName) errors[`${prefix}legalName`] = "required";
  if (!COUNTRY_CODES.includes(fields.countryCode)) errors[`${prefix}countryCode`] = "invalid";
  if (!fields.taxIdentifier) errors[`${prefix}taxIdentifier`] = "required";
  return errors;
}
export function checkContact(fields: ContactFields, prefix = ""): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.name) errors[`${prefix}name`] = "required";
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors[`${prefix}email`] = "invalid";
  return errors;
}
export function checkAddress(fields: AddressFields, prefix = ""): FieldErrors {
  const errors: FieldErrors = {};
  if (!COUNTRY_CODES.includes(fields.countryCode)) errors[`${prefix}countryCode`] = "invalid";
  if (!fields.city) errors[`${prefix}city`] = "required";
  if (!fields.addressLine1) errors[`${prefix}addressLine1`] = "required";
  return errors;
}

/** Field errors from a VALIDATION_FAILED answer, or none. */
export function serverFieldErrors(error: unknown): FieldErrors {
  return error instanceof ApiError && error.code === "VALIDATION_FAILED" ? error.fields : {};
}

/** Names of the fields where the employee's draft differs from the current server record. */
export function differingFields<T extends Record<string, unknown>>(mine: T, current: T, order: Array<keyof T>): Array<keyof T> {
  return order.filter((field) => mine[field] !== current[field]);
}

function useFieldError() {
  const { t } = useI18n();
  const e = t.companies.fieldErrors;
  return (field: string, reason: string | undefined): string | null => {
    if (!reason) return null;
    const leaf = field.split(".").pop() ?? field;
    if (reason === "invalid" && (leaf === "email" || leaf === "website" || leaf === "countryCode" || leaf === "phone" || leaf === "taxIdentifier")) return e[leaf];
    return reason === "required" || reason === "too_long" || reason === "invalid" || reason === "inactive" ? e[reason] : e.invalid;
  };
}

/** A labelled input with its required marker, hint, current-server value (after a conflict) and error. */
export function Field({ name, label, required, hint, error, current, children }: { name: string; label: string; required?: boolean; hint?: string; error?: string; current?: string | null; children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => ReactNode }) {
  const { t } = useI18n();
  const message = useFieldError()(name, error);
  const id = useId();
  const described = [hint ? `${id}-hint` : "", message ? `${id}-error` : "", current !== undefined ? `${id}-current` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${message ? "field-invalid" : ""} ${current !== undefined ? "field-changed" : ""}`}>
      <label htmlFor={id}>{label}{required ? <span className="required" aria-hidden="true"> *</span> : <span className="optional"> · {t.companies.optional}</span>}</label>
      {children({ id, "aria-invalid": Boolean(message), "aria-describedby": described })}
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {current !== undefined && <span className="current-value" id={`${id}-current`}>{t.companies.conflict.currentValue}: <strong>{current === null || current === "" ? t.companies.noValue : current}</strong></span>}
      {message && <span className="field-message" id={`${id}-error`} role="alert">{message}</span>}
    </div>
  );
}

export function CountrySelect({ id, value, onChange, includeAll, ...rest }: { id: string; value: string; onChange: (value: string) => void; includeAll?: boolean; "aria-invalid"?: boolean; "aria-describedby"?: string }) {
  const { t, locale } = useI18n();
  const { frequent, others } = countryOptions(locale);
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} {...rest}>
      {includeAll && <option value="">{t.companies.allCountries}</option>}
      <optgroup label="—">{frequent.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}</optgroup>
      <optgroup label="A–Z">{others.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}</optgroup>
    </select>
  );
}

type Current<T> = Partial<Record<keyof T, string | null>>;

export function CompanyFieldset({ draft, onChange, errors, current, prefix = "", notes = true }: { draft: CompanyDraft; onChange: (draft: CompanyDraft) => void; errors: FieldErrors; current?: Current<CompanyDraft>; prefix?: string; notes?: boolean }) {
  const { t } = useI18n();
  const f = t.companies.fields;
  const set = (field: keyof CompanyDraft) => (value: string) => onChange({ ...draft, [field]: value });
  const text = (field: keyof CompanyDraft, required = false, hint?: string, type = "text", autoComplete = "off") => (
    <Field name={`${prefix}${field}`} label={f[field]} required={required} hint={hint} error={errors[`${prefix}${field}`]} current={current?.[field]}>
      {(props) => <input {...props} type={type} value={draft[field]} autoComplete={autoComplete} maxLength={255} onChange={(event) => set(field)(event.target.value)} />}
    </Field>
  );
  return (
    <div className="form-grid">
      <div className="span-2">{text("legalName", true)}</div>
      {text("displayName")}
      <Field name={`${prefix}countryCode`} label={f.countryCode} required error={errors[`${prefix}countryCode`]} current={current?.countryCode}>
        {(props) => <CountrySelect {...props} value={draft.countryCode} onChange={set("countryCode")} />}
      </Field>
      {text("taxIdentifier", true, t.companies.hints.taxIdentifier)}
      {text("vatNumber")}
      {text("registrationNumber")}
      {text("website", false, t.companies.hints.website, "text", "url")}
      {notes && (
        <div className="span-2">
          <Field name={`${prefix}internalNotes`} label={f.internalNotes} hint={t.companies.notesHint} error={errors[`${prefix}internalNotes`]} current={current?.internalNotes}>
            {(props) => <textarea {...props} rows={4} maxLength={5000} value={draft.internalNotes} onChange={(event) => set("internalNotes")(event.target.value)} />}
          </Field>
        </div>
      )}
    </div>
  );
}

export function ContactFieldset({ draft, onChange, errors, current, prefix = "" }: { draft: ContactDraft; onChange: (draft: ContactDraft) => void; errors: FieldErrors; current?: Current<ContactDraft>; prefix?: string }) {
  const { t } = useI18n();
  const f = t.companies.fields;
  const text = (field: "name" | "jobTitle" | "email" | "phone", required = false, type = "text", autoComplete = "off", max = 160) => (
    <Field name={`${prefix}${field}`} label={f[field]} required={required} error={errors[`${prefix}${field}`]} current={current?.[field]}>
      {(props) => <input {...props} type={type} value={draft[field]} autoComplete={autoComplete} maxLength={max} onChange={(event) => onChange({ ...draft, [field]: event.target.value })} />}
    </Field>
  );
  return (
    <div className="form-grid">
      {text("name", true, "text", "off")}
      {text("jobTitle", false, "text", "off", 120)}
      {text("email", false, "email", "off", 254)}
      {text("phone", false, "tel", "off", 40)}
      <PrimaryToggle checked={draft.isPrimary} onChange={(isPrimary) => onChange({ ...draft, isPrimary })} label={t.companies.hints.contactPrimary} error={errors[`${prefix}isPrimary`]} name={`${prefix}isPrimary`} />
    </div>
  );
}

export function AddressFieldset({ draft, onChange, errors, current, prefix = "" }: { draft: AddressDraft; onChange: (draft: AddressDraft) => void; errors: FieldErrors; current?: Current<AddressDraft>; prefix?: string }) {
  const { t } = useI18n();
  const f = t.companies.fields;
  const text = (field: "label" | "countyRegion" | "city" | "postalCode" | "addressLine1" | "addressLine2", required = false, max = 120) => (
    <Field name={`${prefix}${field}`} label={f[field]} required={required} error={errors[`${prefix}${field}`]} current={current?.[field]}>
      {(props) => <input {...props} type="text" value={draft[field]} autoComplete="off" maxLength={max} onChange={(event) => onChange({ ...draft, [field]: event.target.value })} />}
    </Field>
  );
  return (
    <div className="form-grid">
      <Field name={`${prefix}type`} label={f.type} required error={errors[`${prefix}type`]} current={current?.type === undefined ? undefined : current.type === null ? null : t.companies.addressTypes[current.type as AddressType] ?? current.type}>
        {(props) => (
          <select {...props} value={draft.type} onChange={(event) => onChange({ ...draft, type: event.target.value as AddressType })}>
            {ADDRESS_TYPES.map((type) => <option key={type} value={type}>{t.companies.addressTypes[type]}</option>)}
          </select>
        )}
      </Field>
      {text("label")}
      <div className="span-2">{text("addressLine1", true, 255)}</div>
      <div className="span-2">{text("addressLine2", false, 255)}</div>
      {text("city", true)}
      {text("countyRegion")}
      {text("postalCode", false, 20)}
      <Field name={`${prefix}countryCode`} label={f.countryCode} required error={errors[`${prefix}countryCode`]} current={current?.countryCode}>
        {(props) => <CountrySelect {...props} value={draft.countryCode} onChange={(countryCode) => onChange({ ...draft, countryCode })} />}
      </Field>
      <PrimaryToggle checked={draft.isPrimary} onChange={(isPrimary) => onChange({ ...draft, isPrimary })} label={t.companies.hints.addressPrimary} error={errors[`${prefix}isPrimary`]} name={`${prefix}isPrimary`} />
    </div>
  );
}

function PrimaryToggle({ checked, onChange, label, error, name }: { checked: boolean; onChange: (checked: boolean) => void; label: string; error?: string; name: string }) {
  const message = useFieldError()(name, error);
  const id = useId();
  return (
    <div className="field span-2">
      <label className="checkbox" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-invalid={Boolean(message)} />
        <span>{label}</span>
      </label>
      {message && <span className="field-message" role="alert">{message}</span>}
    </div>
  );
}
