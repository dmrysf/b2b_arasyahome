import { useId, useRef, useState, type FormEvent } from "react";
import type { B2bApi } from "../api/client";
import { ApiError } from "../api/errors";
import { ErrorText } from "../components/ui";
import { toProblem, type Problem } from "../i18n";
import { useI18n } from "../i18n/context";
import {
  AddressFieldset, addressFields, checkAddress, checkCompany, checkContact, CompanyFieldset, companyFields, ContactFieldset, contactFields,
  emptyAddressDraft, emptyCompanyDraft, emptyContactDraft, serverFieldErrors, type FieldErrors,
} from "./forms";
import { Intent } from "./idempotency";
import { COMPANIES_PATH, companyPath } from "./shared";

/**
 * Fast company registration: legal name, country and tax identifier are enough. A first contact and a first address
 * can be added in the same request; both become primary. The server generates the id and the B2B code.
 */
export function CompanyCreatePage({ api, canView, navigate, onCreated }: { api: B2bApi; canView: boolean; navigate: (path: string) => void; onCreated: (companyId: string) => void }) {
  const { t } = useI18n();
  const c = t.companies;
  const [company, setCompany] = useState(emptyCompanyDraft);
  const [withContact, setWithContact] = useState(false);
  const [contact, setContact] = useState(() => emptyContactDraft(true));
  const [withAddress, setWithAddress] = useState(false);
  const [address, setAddress] = useState(() => emptyAddressDraft("RO", true));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const intent = useRef(new Intent());
  const contactToggle = useId();
  const addressToggle = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const payload = {
      ...companyFields(company),
      contact: withContact ? contactFields(contact) : null,
      address: withAddress ? addressFields(address) : null,
    };
    const local = { ...checkCompany(payload), ...(payload.contact ? checkContact(payload.contact, "contact.") : {}), ...(payload.address ? checkAddress(payload.address, "address.") : {}) };
    setErrors(local);
    setProblem(null);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    try {
      const result = await api.createCompany(payload, { idempotencyKey: intent.current.keyFor(payload) });
      intent.current.done();
      if (result.detail) {
        onCreated(result.companyId);
        return;
      }
      setCreatedCode("");
    } catch (error) {
      setErrors(serverFieldErrors(error));
      setProblem(toProblem(error));
    } finally {
      setBusy(false);
    }
  };

  if (createdCode !== null) {
    return (
      <div className="page">
        <header className="page-header"><h1>{c.createTitle}</h1></header>
        <p className="notice notice-success" role="status">{c.createdWithoutView(createdCode)}</p>
        <div><button type="button" className="button button-secondary" onClick={() => { setCompany(emptyCompanyDraft()); setCreatedCode(null); }}>{c.create}</button></div>
      </div>
    );
  }

  const duplicate = problem instanceof ApiError && problem.code === "COMPANY_TAX_ID_ALREADY_EXISTS" ? duplicateTarget(problem) : null;
  return (
    <div className="page">
      <header className="page-header">
        {canView && <a className="back-link" href={COMPANIES_PATH} onClick={(event) => { event.preventDefault(); navigate(COMPANIES_PATH); }}>← {c.back}</a>}
        <h1>{c.createTitle}</h1>
        <p>{c.createSubtitle}</p>
      </header>
      <form className="stack" onSubmit={submit} noValidate>
        <section className="card">
          <h2>{c.sections.info}</h2>
          <CompanyFieldset draft={company} onChange={setCompany} errors={errors} />
        </section>
        <section className="card">
          <label className="checkbox section-toggle" htmlFor={contactToggle}>
            <input id={contactToggle} type="checkbox" checked={withContact} onChange={(event) => setWithContact(event.target.checked)} />
            <span>{c.createExtras.withContact}</span>
          </label>
          {withContact && <ContactFieldset draft={contact} onChange={setContact} errors={errors} prefix="contact." />}
        </section>
        <section className="card">
          <label className="checkbox section-toggle" htmlFor={addressToggle}>
            <input id={addressToggle} type="checkbox" checked={withAddress} onChange={(event) => setWithAddress(event.target.checked)} />
            <span>{c.createExtras.withAddress}</span>
          </label>
          {withAddress && <AddressFieldset draft={address} onChange={setAddress} errors={errors} prefix="address." />}
        </section>
        {problem && (duplicate ? (
          <div className="notice notice-error" role="alert">
            <p>{c.duplicate.message}</p>
            {duplicate.id && canView && <a href={companyPath(duplicate.id)} onClick={(event) => { event.preventDefault(); navigate(companyPath(duplicate.id as string)); }}>{c.duplicate.open(duplicate.code ?? "")}</a>}
          </div>
        ) : <ErrorText error={problem} />)}
        {Object.keys(errors).length > 0 && !problem && <p className="form-error" role="alert">{c.fieldErrors.summary}</p>}
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? t.common.saving : c.actions.createCompany}</button>
          {canView && <button type="button" className="button button-ghost" onClick={() => navigate(COMPANIES_PATH)} disabled={busy}>{c.actions.cancel}</button>}
        </div>
      </form>
    </div>
  );
}

/** The existing company named by a tax-identifier conflict (present only for viewers). */
export function duplicateTarget(error: ApiError): { id: string | null; code: string | null } {
  const company = error.details && typeof error.details === "object" ? (error.details as { company?: { id?: unknown; code?: unknown } }).company : undefined;
  return { id: typeof company?.id === "string" ? company.id : null, code: typeof company?.code === "string" ? company.code : null };
}
