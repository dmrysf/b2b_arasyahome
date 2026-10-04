import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { B2bApi } from "../api/client";
import type { ActivityEvent, Address, AddressType, CompanyDetail, CompanyMutation, Contact, RecordStatus } from "../api/companies";
import { ErrorText } from "../components/ui";
import { toProblem, type Problem } from "../i18n";
import { useI18n } from "../i18n/context";
import { countryName } from "./countries";
import {
  ADDRESS_FIELD_ORDER, AddressFieldset, addressDraft, addressFields, checkAddress, checkCompany, checkContact, COMPANY_FIELD_ORDER, CompanyFieldset,
  companyDraft, companyFields, CONTACT_FIELD_ORDER, ContactFieldset, contactDraft, contactFields, emptyAddressDraft, emptyContactDraft,
  type AddressDraft, type CompanyDraft, type ContactDraft,
} from "./forms";
import { Intent } from "./idempotency";
import { COMPANIES_PATH, PrimaryBadge, StatusBadge, SuccessNotice } from "./shared";
import { useEditor, type Conflict } from "./useEditor";

type Section = "info" | "contacts" | "addresses" | "notes" | "activity";
const SECTIONS: Section[] = ["info", "contacts", "addresses", "notes", "activity"];

/**
 * One company: identity and fiscal data, contacts, addresses, internal notes and activity, each in its own section
 * so no single form grows huge. Every action is offered only with the matching permission; the server decides.
 */
export function CompanyDetailPage({ api, id, navigate, flash }: { api: B2bApi; id: string; navigate: (path: string) => void; flash: string | null }) {
  const { t } = useI18n();
  const c = t.companies;
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [section, setSection] = useState<Section>("info");
  const [notice, setNotice] = useState<string | null>(flash);

  useEffect(() => {
    let active = true;
    api.getCompany(id).then((loaded) => { if (active) setDetail(loaded); }, (error) => { if (active) setProblem(toProblem(error)); });
    return () => { active = false; };
  }, [api, id]);

  const applied = (message: string) => (result: CompanyMutation) => {
    if (result.detail) setDetail(result.detail);
    setNotice(message);
  };
  const reload = async () => {
    const loaded = await api.getCompany(id);
    setDetail(loaded);
    return loaded;
  };

  const back = <a className="back-link" href={COMPANIES_PATH} onClick={(event) => { event.preventDefault(); navigate(COMPANIES_PATH); }}>← {c.back}</a>;
  if (!detail) {
    return (
      <div className="page">
        <header className="page-header">{back}</header>
        {problem ? <ErrorText error={problem} /> : <p className="muted" role="status">{c.loading}</p>}
      </div>
    );
  }

  const { company, capabilities } = detail;
  const counts: Partial<Record<Section, number>> = {
    contacts: detail.contacts.filter((contact) => contact.status === "active").length,
    addresses: detail.addresses.filter((address) => address.status === "active").length,
  };
  return (
    <div className="page page-wide">
      <header className="page-header company-header">
        {back}
        <div className="company-title">
          <div>
            <p className="eyebrow mono">{company.code}</p>
            <h1>{company.legalName}</h1>
            {company.displayName && company.displayName !== company.legalName && <p>{company.displayName}</p>}
          </div>
          <StatusBadge status={company.status} />
        </div>
      </header>
      <SuccessNotice message={notice} />
      {capabilities.canManageStatus && <CompanyStatusControl api={api} detail={detail} onDone={(result, status) => applied(status === "active" ? c.success.reactivated : c.success.deactivated)(result)} />}

      <div className="section-tabs" role="tablist" aria-label={c.title}>
        {SECTIONS.map((key) => (
          <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={section === key} aria-controls={`panel-${key}`} onClick={() => { setSection(key); setNotice(null); }}>
            {c.sections[key]}{counts[key] !== undefined && <span className="count">{counts[key]}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`}>
        {section === "info" && <InfoSection api={api} detail={detail} reload={reload} onSaved={applied(c.success.updated)} />}
        {section === "notes" && <NotesSection api={api} detail={detail} reload={reload} onSaved={applied(c.success.notesSaved)} />}
        {section === "contacts" && <ContactsSection api={api} detail={detail} reload={reload} onChanged={(result, message) => applied(message)(result)} />}
        {section === "addresses" && <AddressesSection api={api} detail={detail} reload={reload} onChanged={(result, message) => applied(message)(result)} />}
        {section === "activity" && <ActivitySection key={company.version + detail.contacts.length + detail.addresses.length} api={api} companyId={company.id} />}
      </div>
    </div>
  );
}

function ConflictPanel<D>({ conflict, busy, onLoad }: { conflict: Conflict<D>; busy: boolean; onLoad: () => void }) {
  const { t } = useI18n();
  const k = t.companies.conflict;
  if (!conflict) return null;
  if (conflict.phase === "gone") return <div className="notice notice-error" role="alert">{k.gone}</div>;
  if (conflict.phase === "pending") {
    return (
      <div className="notice notice-warning" role="alert">
        <p><strong>{k.title}</strong></p>
        <p>{k.body}</p>
        <div><button type="button" className="button button-secondary" disabled={busy} onClick={onLoad}>{k.load}</button></div>
      </div>
    );
  }
  return <div className="notice notice-warning" role="status">{Object.keys(conflict.current).length > 0 ? k.rebased : k.noDifferences}</div>;
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return <dl className="facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function companyEditorOptions(api: B2bApi, detail: CompanyDetail, reload: () => Promise<CompanyDetail>, onSaved: (result: CompanyMutation) => void, displayCountry: (code: string) => string) {
  return {
    initial: companyDraft(detail.company),
    version: detail.company.version,
    toFields: companyFields,
    check: (fields: ReturnType<typeof companyFields>) => checkCompany(fields),
    save: (fields: ReturnType<typeof companyFields>, version: number, key: string) => api.updateCompany(detail.company.id, fields, version, { idempotencyKey: key }),
    changedCode: "COMPANY_CHANGED",
    loadCurrent: async () => { const current = await reload(); return { draft: companyDraft(current.company), version: current.company.version }; },
    order: COMPANY_FIELD_ORDER as Array<keyof CompanyDraft>,
    display: (field: keyof CompanyDraft, draft: CompanyDraft) => (field === "countryCode" ? displayCountry(draft.countryCode) : draft[field] || null),
    onSaved,
  };
}

function InfoSection({ api, detail, reload, onSaved }: { api: B2bApi; detail: CompanyDetail; reload: () => Promise<CompanyDetail>; onSaved: (result: CompanyMutation) => void }) {
  const { t, locale, dateTime } = useI18n();
  const c = t.companies;
  const [editing, setEditing] = useState(false);
  const { company, capabilities } = detail;
  if (editing) return <InfoEditor api={api} detail={detail} reload={reload} onClose={() => setEditing(false)} onSaved={(result) => { setEditing(false); onSaved(result); }} />;
  const none = c.noValue;
  return (
    <section className="card">
      <div className="card-header">
        <h2>{c.sections.info}</h2>
        {capabilities.canUpdate && <button type="button" className="button button-secondary" onClick={() => setEditing(true)}>{c.actions.edit}</button>}
      </div>
      <Facts rows={[
        [c.fields.code, <span key="code" className="mono">{company.code}</span>],
        [c.fields.legalName, company.legalName],
        [c.fields.displayName, company.displayName ?? none],
        [c.fields.countryCode, countryName(company.countryCode, locale)],
        [c.fields.taxIdentifier, <span key="tax" className="mono">{company.taxIdentifier}</span>],
        [c.fields.vatNumber, company.vatNumber ?? none],
        [c.fields.registrationNumber, company.registrationNumber ?? none],
        [c.fields.website, company.website ? <a key="website" className="link" href={company.website} target="_blank" rel="noopener noreferrer nofollow">{company.website}</a> : none],
        [c.fields.status, <StatusBadge key="status" status={company.status} />],
      ]} />
      <p className="meta">{c.meta.created(company.createdBy.displayName, dateTime(company.createdAt))} · {c.meta.updated(company.updatedBy.displayName, dateTime(company.updatedAt))}</p>
      {company.status === "inactive" && company.statusChangedAt && <p className="meta">{c.meta.inactiveSince(dateTime(company.statusChangedAt))}</p>}
    </section>
  );
}

/** Mounted when editing starts, so the employee's draft survives a reload of the company after a conflict. */
function InfoEditor({ api, detail, reload, onClose, onSaved }: { api: B2bApi; detail: CompanyDetail; reload: () => Promise<CompanyDetail>; onClose: () => void; onSaved: (result: CompanyMutation) => void }) {
  const { t, locale } = useI18n();
  const c = t.companies;
  const editor = useEditor({
    ...companyEditorOptions(api, detail, reload, onSaved, (code) => countryName(code, locale)),
    order: COMPANY_FIELD_ORDER.filter((field) => field !== "internalNotes") as Array<keyof CompanyDraft>,
  });
  return (
    <form className="card" onSubmit={(event: FormEvent) => { event.preventDefault(); void editor.save(); }} noValidate>
      <h2>{c.sections.info}</h2>
      <ConflictPanel conflict={editor.conflict} busy={editor.busy} onLoad={() => { void editor.loadCurrent(); }} />
      <CompanyFieldset draft={editor.draft} onChange={editor.setDraft} errors={editor.errors} notes={false} current={editor.conflict?.phase === "rebased" ? editor.conflict.current : undefined} />
      {editor.problem && <ErrorText error={editor.problem} />}
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={editor.busy || editor.conflict?.phase === "pending" || editor.conflict?.phase === "gone"}>{editor.busy ? t.common.saving : c.actions.save}</button>
        <button type="button" className="button button-ghost" disabled={editor.busy} onClick={onClose}>{c.actions.cancel}</button>
      </div>
    </form>
  );
}

function NotesSection({ api, detail, reload, onSaved }: { api: B2bApi; detail: CompanyDetail; reload: () => Promise<CompanyDetail>; onSaved: (result: CompanyMutation) => void }) {
  const { t } = useI18n();
  const c = t.companies;
  const [editing, setEditing] = useState(false);
  if (editing) return <NotesEditor api={api} detail={detail} reload={reload} onClose={() => setEditing(false)} onSaved={(result) => { setEditing(false); onSaved(result); }} />;
  const notes = detail.company.internalNotes;
  return (
    <section className="card">
      <div className="card-header">
        <h2>{c.sections.notes}</h2>
        {detail.capabilities.canUpdate && <button type="button" className="button button-secondary" onClick={() => setEditing(true)}>{c.actions.editNotes}</button>}
      </div>
      {notes ? <p className="pre notes">{notes}</p> : <p className="muted">{c.none.notes}</p>}
      <p className="hint">{c.notesHint}</p>
    </section>
  );
}

function NotesEditor({ api, detail, reload, onClose, onSaved }: { api: B2bApi; detail: CompanyDetail; reload: () => Promise<CompanyDetail>; onClose: () => void; onSaved: (result: CompanyMutation) => void }) {
  const { t, locale } = useI18n();
  const c = t.companies;
  const editor = useEditor({
    ...companyEditorOptions(api, detail, reload, onSaved, (code) => countryName(code, locale)),
    // Only the note is edited here; every other field is sent as the server currently has it.
    order: ["internalNotes"] as Array<keyof CompanyDraft>,
  });
  const current = editor.conflict?.phase === "rebased" ? editor.conflict.current : undefined;
  return (
    <form className="card" onSubmit={(event: FormEvent) => { event.preventDefault(); void editor.save(); }} noValidate>
      <h2>{c.sections.notes}</h2>
      <ConflictPanel conflict={editor.conflict} busy={editor.busy} onLoad={() => { void editor.loadCurrent(); }} />
      <label className="sr-only" htmlFor="company-notes">{c.fields.internalNotes}</label>
      <textarea id="company-notes" rows={8} maxLength={5000} value={editor.draft.internalNotes} aria-invalid={Boolean(editor.errors.internalNotes)}
        onChange={(event) => editor.setDraft({ ...editor.draft, internalNotes: event.target.value })} />
      {current && "internalNotes" in current && <p className="current-value">{c.conflict.currentValue}: <span className="pre">{current.internalNotes ?? c.noValue}</span></p>}
      <p className="hint">{c.notesHint}</p>
      {editor.problem && <ErrorText error={editor.problem} />}
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={editor.busy || editor.conflict?.phase === "pending" || editor.conflict?.phase === "gone"}>{editor.busy ? t.common.saving : c.actions.save}</button>
        <button type="button" className="button button-ghost" disabled={editor.busy} onClick={onClose}>{c.actions.cancel}</button>
      </div>
    </form>
  );
}

/** Two-step status change with an explicit confirmation; retries reuse one Idempotency-Key. */
function useStatusAction() {
  const intent = useRef(new Intent());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const run = async (payload: unknown, action: (key: string) => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action(intent.current.keyFor(payload));
      intent.current.done();
      setConfirming(false);
    } catch (error) {
      setProblem(toProblem(error));
    } finally {
      setBusy(false);
    }
  };
  return { confirming, setConfirming, busy, problem, run };
}

function CompanyStatusControl({ api, detail, onDone }: { api: B2bApi; detail: CompanyDetail; onDone: (result: CompanyMutation, status: RecordStatus) => void }) {
  const { t } = useI18n();
  const c = t.companies;
  const action = useStatusAction();
  const next: RecordStatus = detail.company.status === "active" ? "inactive" : "active";
  return (
    <div className="status-control">
      {!action.confirming ? (
        <button type="button" className={`button ${next === "inactive" ? "button-danger-ghost" : "button-secondary"}`} onClick={() => action.setConfirming(true)}>
          {next === "inactive" ? c.actions.deactivate : c.actions.reactivate}
        </button>
      ) : (
        <div className="confirm" role="group" aria-label={next === "inactive" ? c.actions.deactivate : c.actions.reactivate}>
          <p>{next === "inactive" ? c.confirm.deactivateCompany : c.confirm.reactivateCompany}</p>
          <div className="form-actions">
            <button type="button" className={`button ${next === "inactive" ? "button-danger" : "button-primary"}`} disabled={action.busy}
              onClick={() => { void action.run({ id: detail.company.id, next, version: detail.company.version }, async (key) => onDone(await api.setCompanyStatus(detail.company.id, next, detail.company.version, { idempotencyKey: key }), next)); }}>
              {action.busy ? t.common.saving : next === "inactive" ? c.actions.confirmDeactivate : c.actions.confirmReactivate}
            </button>
            <button type="button" className="button button-ghost" disabled={action.busy} onClick={() => action.setConfirming(false)}>{c.actions.cancel}</button>
          </div>
        </div>
      )}
      {action.problem && <ErrorText error={action.problem} />}
    </div>
  );
}

type ChildProps = { api: B2bApi; detail: CompanyDetail; reload: () => Promise<CompanyDetail>; onChanged: (result: CompanyMutation, message: string) => void };

function ContactsSection({ api, detail, reload, onChanged }: ChildProps) {
  const { t } = useI18n();
  const c = t.companies;
  const [editing, setEditing] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const canUpdate = detail.capabilities.canUpdate;
  const visible = detail.contacts.filter((contact) => showInactive || contact.status === "active");
  const hasInactive = detail.contacts.some((contact) => contact.status === "inactive");
  return (
    <section className="card">
      <div className="card-header">
        <h2>{c.sections.contacts}</h2>
        {canUpdate && editing !== "new" && <button type="button" className="button button-secondary" onClick={() => setEditing("new")}>{c.actions.addContact}</button>}
      </div>
      {editing === "new" && <ContactEditor api={api} detail={detail} reload={reload} contact={null} onClose={() => setEditing(null)} onSaved={(result) => { setEditing(null); onChanged(result, c.success.contactSaved); }} />}
      {visible.length === 0 && editing !== "new" && <p className="muted">{c.none.contacts}</p>}
      <ul className="record-list">
        {visible.map((contact) => (
          <li key={contact.id} className={contact.status === "inactive" ? "is-inactive" : undefined}>
            {editing === contact.id ? (
              <ContactEditor api={api} detail={detail} reload={reload} contact={contact} onClose={() => setEditing(null)} onSaved={(result) => { setEditing(null); onChanged(result, c.success.contactSaved); }} />
            ) : (
              <ContactCard api={api} detail={detail} contact={contact} canUpdate={canUpdate} onEdit={() => setEditing(contact.id)} onChanged={onChanged} />
            )}
          </li>
        ))}
      </ul>
      {hasInactive && <label className="checkbox"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /><span>{c.actions.showInactive}</span></label>}
    </section>
  );
}

function ContactCard({ api, detail, contact, canUpdate, onEdit, onChanged }: { api: B2bApi; detail: CompanyDetail; contact: Contact; canUpdate: boolean; onEdit: () => void; onChanged: ChildProps["onChanged"] }) {
  const { t } = useI18n();
  const c = t.companies;
  const action = useStatusAction();
  const next: RecordStatus = contact.status === "active" ? "inactive" : "active";
  const change = () => action.run({ contact: contact.id, next, version: contact.version }, async (key) => {
    onChanged(await api.setContactStatus(detail.company.id, contact.id, next, contact.version, { idempotencyKey: key }), next === "active" ? c.success.contactReactivated : c.success.contactDeactivated);
  });
  return (
    <div className="record">
      <div className="record-main">
        <div className="record-title"><strong>{contact.name}</strong>{contact.isPrimary && <PrimaryBadge />}{contact.status === "inactive" && <StatusBadge status="inactive" />}</div>
        {contact.jobTitle && <span className="muted">{contact.jobTitle}</span>}
        <div className="record-lines">
          {contact.phone && <a className="link" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a>}
          {contact.email && <a className="link" href={`mailto:${contact.email}`}>{contact.email}</a>}
        </div>
      </div>
      {canUpdate && <RecordActions action={action} next={next} confirmText={c.confirm.deactivateContact} onEdit={contact.status === "active" ? onEdit : null} onConfirm={() => { void change(); }} />}
    </div>
  );
}

function RecordActions({ action, next, confirmText, onEdit, onConfirm }: { action: ReturnType<typeof useStatusAction>; next: RecordStatus; confirmText: string; onEdit: (() => void) | null; onConfirm: () => void }) {
  const { t } = useI18n();
  const c = t.companies;
  return (
    <div className="record-actions">
      {action.confirming ? (
        <div className="confirm">
          {next === "inactive" && <p>{confirmText}</p>}
          <div className="form-actions">
            <button type="button" className={`button ${next === "inactive" ? "button-danger" : "button-primary"}`} disabled={action.busy} onClick={onConfirm}>
              {action.busy ? t.common.saving : next === "inactive" ? c.actions.confirmDeactivate : c.actions.confirmReactivate}
            </button>
            <button type="button" className="button button-ghost" disabled={action.busy} onClick={() => action.setConfirming(false)}>{c.actions.cancel}</button>
          </div>
        </div>
      ) : (
        <div className="form-actions">
          {onEdit && <button type="button" className="button button-ghost" onClick={onEdit}>{c.actions.edit}</button>}
          <button type="button" className="button button-ghost" onClick={() => action.setConfirming(true)}>{next === "inactive" ? c.actions.deactivate : c.actions.reactivate}</button>
        </div>
      )}
      {action.problem && <ErrorText error={action.problem} />}
    </div>
  );
}

function ContactEditor({ api, detail, reload, contact, onClose, onSaved }: { api: B2bApi; detail: CompanyDetail; reload: () => Promise<CompanyDetail>; contact: Contact | null; onClose: () => void; onSaved: (result: CompanyMutation) => void }) {
  const { t } = useI18n();
  const c = t.companies;
  const companyId = detail.company.id;
  const editor = useEditor<ContactDraft, ReturnType<typeof contactFields>>({
    initial: contact ? contactDraft(contact) : emptyContactDraft(!detail.contacts.some((existing) => existing.isPrimary)),
    version: contact?.version ?? 0,
    toFields: contactFields,
    check: (fields) => checkContact(fields),
    save: (fields, version, key) => (contact ? api.updateContact(companyId, contact.id, fields, version, { idempotencyKey: key }) : api.createContact(companyId, fields, { idempotencyKey: key })),
    changedCode: "CONTACT_CHANGED",
    loadCurrent: async () => {
      const current = (await reload()).contacts.find((candidate) => candidate.id === contact?.id);
      return current && current.status === "active" ? { draft: contactDraft(current), version: current.version } : null;
    },
    order: CONTACT_FIELD_ORDER as Array<keyof ContactDraft>,
    display: (field, draft) => (field === "isPrimary" ? (draft.isPrimary ? c.primary : c.noValue) : (draft[field] as string) || null),
    onSaved,
  });
  return (
    <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void editor.save(); }} noValidate>
      <ConflictPanel conflict={editor.conflict} busy={editor.busy} onLoad={() => { void editor.loadCurrent(); }} />
      <ContactFieldset draft={editor.draft} onChange={editor.setDraft} errors={editor.errors} current={editor.conflict?.phase === "rebased" ? editor.conflict.current : undefined} />
      {editor.problem && <ErrorText error={editor.problem} />}
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={editor.busy || editor.conflict?.phase === "pending" || editor.conflict?.phase === "gone"}>{editor.busy ? t.common.saving : c.actions.save}</button>
        <button type="button" className="button button-ghost" disabled={editor.busy} onClick={onClose}>{c.actions.cancel}</button>
      </div>
    </form>
  );
}

function AddressesSection({ api, detail, reload, onChanged }: ChildProps) {
  const { t } = useI18n();
  const c = t.companies;
  const [editing, setEditing] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const canUpdate = detail.capabilities.canUpdate;
  const visible = detail.addresses.filter((address) => showInactive || address.status === "active");
  const hasInactive = detail.addresses.some((address) => address.status === "inactive");
  return (
    <section className="card">
      <div className="card-header">
        <h2>{c.sections.addresses}</h2>
        {canUpdate && editing !== "new" && <button type="button" className="button button-secondary" onClick={() => setEditing("new")}>{c.actions.addAddress}</button>}
      </div>
      {editing === "new" && <AddressEditor api={api} detail={detail} reload={reload} address={null} onClose={() => setEditing(null)} onSaved={(result) => { setEditing(null); onChanged(result, c.success.addressSaved); }} />}
      {visible.length === 0 && editing !== "new" && <p className="muted">{c.none.addresses}</p>}
      <ul className="record-list">
        {visible.map((address) => (
          <li key={address.id} className={address.status === "inactive" ? "is-inactive" : undefined}>
            {editing === address.id ? (
              <AddressEditor api={api} detail={detail} reload={reload} address={address} onClose={() => setEditing(null)} onSaved={(result) => { setEditing(null); onChanged(result, c.success.addressSaved); }} />
            ) : (
              <AddressCard api={api} detail={detail} address={address} canUpdate={canUpdate} onEdit={() => setEditing(address.id)} onChanged={onChanged} />
            )}
          </li>
        ))}
      </ul>
      {hasInactive && <label className="checkbox"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /><span>{c.actions.showInactive}</span></label>}
    </section>
  );
}

function AddressCard({ api, detail, address, canUpdate, onEdit, onChanged }: { api: B2bApi; detail: CompanyDetail; address: Address; canUpdate: boolean; onEdit: () => void; onChanged: ChildProps["onChanged"] }) {
  const { t, locale } = useI18n();
  const c = t.companies;
  const action = useStatusAction();
  const next: RecordStatus = address.status === "active" ? "inactive" : "active";
  const change = () => action.run({ address: address.id, next, version: address.version }, async (key) => {
    onChanged(await api.setAddressStatus(detail.company.id, address.id, next, address.version, { idempotencyKey: key }), next === "active" ? c.success.addressReactivated : c.success.addressDeactivated);
  });
  const locality = [address.postalCode, address.city, address.countyRegion].filter(Boolean).join(", ");
  return (
    <div className="record">
      <div className="record-main">
        <div className="record-title">
          <span className={`badge badge-type badge-${address.type}`}>{c.addressTypes[address.type]}</span>
          {address.label && <strong>{address.label}</strong>}
          {address.isPrimary && <PrimaryBadge />}
          {address.status === "inactive" && <StatusBadge status="inactive" />}
        </div>
        <address className="record-lines">
          <span>{address.addressLine1}</span>
          {address.addressLine2 && <span>{address.addressLine2}</span>}
          <span>{locality}</span>
          <span>{countryName(address.countryCode, locale)}</span>
        </address>
      </div>
      {canUpdate && <RecordActions action={action} next={next} confirmText={c.confirm.deactivateAddress} onEdit={address.status === "active" ? onEdit : null} onConfirm={() => { void change(); }} />}
    </div>
  );
}

function AddressEditor({ api, detail, reload, address, onClose, onSaved }: { api: B2bApi; detail: CompanyDetail; reload: () => Promise<CompanyDetail>; address: Address | null; onClose: () => void; onSaved: (result: CompanyMutation) => void }) {
  const { t, locale } = useI18n();
  const c = t.companies;
  const companyId = detail.company.id;
  const hasPrimary = (type: AddressType) => detail.addresses.some((existing) => existing.isPrimary && existing.type === type);
  const editor = useEditor<AddressDraft, ReturnType<typeof addressFields>>({
    initial: address ? addressDraft(address) : emptyAddressDraft(detail.company.countryCode, !hasPrimary("billing")),
    version: address?.version ?? 0,
    toFields: addressFields,
    check: (fields) => checkAddress(fields),
    save: (fields, version, key) => (address ? api.updateAddress(companyId, address.id, fields, version, { idempotencyKey: key }) : api.createAddress(companyId, fields, { idempotencyKey: key })),
    changedCode: "ADDRESS_CHANGED",
    loadCurrent: async () => {
      const current = (await reload()).addresses.find((candidate) => candidate.id === address?.id);
      return current && current.status === "active" ? { draft: addressDraft(current), version: current.version } : null;
    },
    order: ADDRESS_FIELD_ORDER as Array<keyof AddressDraft>,
    display: (field, draft) => {
      if (field === "isPrimary") return draft.isPrimary ? c.primary : c.noValue;
      if (field === "countryCode") return countryName(draft.countryCode, locale);
      if (field === "type") return draft.type;
      return (draft[field] as string) || null;
    },
    onSaved,
  });
  return (
    <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void editor.save(); }} noValidate>
      <ConflictPanel conflict={editor.conflict} busy={editor.busy} onLoad={() => { void editor.loadCurrent(); }} />
      <AddressFieldset draft={editor.draft} onChange={editor.setDraft} errors={editor.errors} current={editor.conflict?.phase === "rebased" ? editor.conflict.current : undefined} />
      {editor.problem && <ErrorText error={editor.problem} />}
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={editor.busy || editor.conflict?.phase === "pending" || editor.conflict?.phase === "gone"}>{editor.busy ? t.common.saving : c.actions.save}</button>
        <button type="button" className="button button-ghost" disabled={editor.busy} onClick={onClose}>{c.actions.cancel}</button>
      </div>
    </form>
  );
}

function ActivitySection({ api, companyId }: { api: B2bApi; companyId: string }) {
  const { t, dateTime } = useI18n();
  const c = t.companies;
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    let active = true;
    api.companyActivity(companyId).then(
      (page) => { if (active) { setEvents(page.items); setCursor(page.nextCursor); setLoading(false); } },
      (error) => { if (active) { setProblem(toProblem(error)); setLoading(false); } },
    );
    return () => { active = false; };
  }, [api, companyId]);

  const more = () => {
    setLoading(true);
    api.companyActivity(companyId, cursor).then(
      (page) => { setEvents((previous) => [...previous, ...page.items]); setCursor(page.nextCursor); setLoading(false); },
      (error) => { setProblem(toProblem(error)); setLoading(false); },
    );
  };

  const fieldLabel = (field: string) => (Object.hasOwn(c.fields, field) ? c.fields[field as keyof typeof c.fields] : field);
  const subject = (event: ActivityEvent) => {
    if (event.subject.type === "contact") return event.subject.name ?? null;
    if (event.subject.type === "address") {
      const type = event.subject.addressType && Object.hasOwn(c.addressTypes, event.subject.addressType) ? c.addressTypes[event.subject.addressType as AddressType] : null;
      return [type, event.subject.label, event.subject.city].filter(Boolean).join(" · ") || null;
    }
    return null;
  };
  return (
    <section className="card">
      <h2>{c.sections.activity}</h2>
      {events.length === 0 && !loading && !problem && <p className="muted">{c.none.activity}</p>}
      <ol className="timeline">
        {events.map((event) => (
          <li key={event.id}>
            <div className="timeline-head">
              <strong>{Object.hasOwn(c.activity.actions, event.action) ? c.activity.actions[event.action as keyof typeof c.activity.actions] : c.activity.unknownAction}</strong>
              {subject(event) && <span>{subject(event)}</span>}
            </div>
            {event.changedFields.length > 0 && <p className="muted">{c.activity.changed} {event.changedFields.map(fieldLabel).join(", ")}</p>}
            <p className="meta">{c.activity.by(event.actor.displayName)} · {dateTime(event.occurredAt)}</p>
          </li>
        ))}
      </ol>
      {problem && <ErrorText error={problem} />}
      {loading && <p className="muted" role="status">{c.loading}</p>}
      {cursor && !loading && <div><button type="button" className="button button-secondary" onClick={more}>{c.loadMore}</button></div>}
    </section>
  );
}
