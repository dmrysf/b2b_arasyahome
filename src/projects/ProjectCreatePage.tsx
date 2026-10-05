import { useEffect, useRef, useState } from "react";
import type { B2bApi } from "../api/client";
import type { CompanyListItem } from "../api/companies";
import { PROPERTY_TYPES, type ProjectOperation, type PropertyType } from "../api/projects";
import { Intent } from "../companies/idempotency";
import { useI18n } from "../i18n/context";
import { batches, PROJECTS_PATH, projectPath, scaffold } from "./model";

/**
 * Guided but short: type, company and name on one screen, plus an optional structure generator for repeated buildings.
 * Every request carries an idempotency key, so a double tap or a retry after a lost connection creates nothing twice.
 */
export function ProjectCreatePage({ api, canCreate, canCompanyView, companyId, navigate }: {
  api: B2bApi; canCreate: boolean; canCompanyView: boolean; companyId?: string; navigate: (path: string) => void;
}) {
  const { t, problem } = useI18n(), p = t.projects;
  const [type, setType] = useState<PropertyType>("hotel");
  const [form, setForm] = useState({ companyId: companyId ?? "", name: "", currencyCode: "RON" as "RON" | "EUR", siteAddress: "", customerReference: "", notes: "" });
  const [structure, setStructure] = useState({ enabled: false, floors: "3", firstLevel: "1", roomsPerFloor: "10", roomPrefix: p.roomLabel, windowsPerRoom: "2" });
  const [search, setSearch] = useState(""), [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [fields, setFields] = useState<Record<string, string>>({});
  const [createdId, setCreatedId] = useState<string | null>(null);
  const created = useRef<string | null>(null), intent = useRef(new Intent()), structureIntents = useRef<Intent[]>([]);
  const scaffolded = useRef<{ key: string; parts: ReturnType<typeof batches<ProjectOperation>>; done: number } | null>(null);
  useEffect(() => {
    if (!canCompanyView) return;
    let active = true;
    const timer = setTimeout(() => {
      api.listCompanies({ search, status: "active", limit: 50 }).then(d => { if (active) setCompanies(d.items); }, e => { if (active) setError(e); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [api, canCompanyView, search]);
  if (!canCreate || !canCompanyView) return <section className="card"><h1>{p.noCreate}</h1></section>;
  const n = (v: string, min: number, max: number) => { const x = Number(v); return Number.isInteger(x) ? Math.max(min, Math.min(max, x)) : min; };
  const plan = { floors: n(structure.floors, 1, 60), firstLevel: n(structure.firstLevel, -5, 120), roomsPerFloor: n(structure.roomsPerFloor, 1, 200),
    windowsPerRoom: n(structure.windowsPerRoom, 0, 12) };
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(null); setFields({});
    try {
      let id = created.current;
      if (!id) {
        const body = { companyId: form.companyId, name: form.name.trim(), propertyType: type, currencyCode: form.currencyCode,
          siteAddress: form.siteAddress.trim() || null, customerReference: form.customerReference.trim() || null, notes: form.notes.trim() || null };
        const result = await api.createProject(body, { idempotencyKey: intent.current.keyFor(body) });
        id = created.current = result.projectId;
        setCreatedId(id);
      }
      if (structure.enabled) {
        // Generated once per plan, so a retry resends identical batches (same node ids, same keys) and creates nothing twice.
        const planKey = JSON.stringify({ ...plan, prefix: structure.roomPrefix });
        if (scaffolded.current?.key !== planKey)
          scaffolded.current = { key: planKey, parts: batches(scaffold({ ...plan, roomPrefix: structure.roomPrefix, floorLabel: p.floorLabel, windowLabel: p.windowLabel })), done: 0 };
        const plan_ = scaffolded.current;
        for (let i = plan_.done; i < plan_.parts.length; i++) {
          structureIntents.current[i] ??= new Intent();
          await api.changeProject(id, plan_.parts[i], { idempotencyKey: structureIntents.current[i].keyFor(plan_.parts[i]) });
          plan_.done = i + 1;
        }
      }
      navigate(projectPath(id));
    } catch (e) {
      setError(e);
      setFields(e && typeof e === "object" && "fields" in e ? (e as { fields: Record<string, string> }).fields : {});
    } finally { setBusy(false); }
  };
  const field = (key: "name" | "siteAddress" | "customerReference", label: string, max: number) =>
    <label>{label}<input value={form[key]} maxLength={max} aria-invalid={!!fields[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>;
  return <form className="page project-create" aria-label={p.createTitle} onSubmit={e => { e.preventDefault(); void submit(); }}>
    <header className="page-header">
      <a className="back-link" href={PROJECTS_PATH} onClick={e => { e.preventDefault(); navigate(PROJECTS_PATH); }}>← {p.back}</a>
      <h1>{p.createTitle}</h1><p>{p.createSubtitle}</p>
    </header>
    <fieldset className="card property-types" disabled={busy || createdId !== null}>
      <legend>{p.propertyType}</legend>
      <div className="type-grid" role="radiogroup" aria-label={p.propertyType}>
        {PROPERTY_TYPES.map(value => <label key={value} className={`type-option ${type === value ? "selected" : ""}`}>
          <input type="radio" name="propertyType" value={value} checked={type === value} onChange={() => setType(value)} />{p.types[value]}
        </label>)}
      </div>
    </fieldset>
    <fieldset className="card" disabled={busy || createdId !== null}>
      <div className="grid-2">
        <label>{p.companySearch}<input value={search} onChange={e => setSearch(e.target.value)} /></label>
        <label>{p.company}<select aria-label={p.company} value={form.companyId} aria-invalid={!!fields.companyId} required onChange={e => setForm(f => ({ ...f, companyId: e.target.value }))}>
          <option value="">{p.selectCompany}</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.legalName} · {c.code}</option>)}
        </select></label>
      </div>
      <div className="grid-2">{field("name", p.name, 160)}
        <label>{p.currency}<select value={form.currencyCode} onChange={e => setForm(f => ({ ...f, currencyCode: e.target.value as "RON" | "EUR" }))}><option>RON</option><option>EUR</option></select></label>
      </div>
      <div className="grid-2">{field("siteAddress", p.siteAddress, 300)}{field("customerReference", p.customerReference, 160)}</div>
      <label>{p.notes}<textarea value={form.notes} maxLength={2000} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></label>
    </fieldset>
    <fieldset className="card" disabled={busy}>
      <label className="checkbox"><input type="checkbox" checked={structure.enabled} onChange={e => setStructure(s => ({ ...s, enabled: e.target.checked }))} />{p.structure}</label>
      <p className="muted">{p.structureHint}</p>
      {structure.enabled && <>
        <div className="structure-grid">
          {([["floors", p.floors], ["firstLevel", p.firstLevel], ["roomsPerFloor", p.roomsPerFloor], ["windowsPerRoom", p.windowsPerRoom]] as const).map(([key, label]) =>
            <label key={key}>{label}<input inputMode="numeric" value={structure[key]} onChange={e => setStructure(s => ({ ...s, [key]: e.target.value }))} /></label>)}
          <label>{p.roomPrefix}<input value={structure.roomPrefix} maxLength={40} onChange={e => setStructure(s => ({ ...s, roomPrefix: e.target.value }))} /></label>
        </div>
        <p className="badge badge-accent" role="status">{p.structurePreview(plan.floors, plan.floors * plan.roomsPerFloor, plan.floors * plan.roomsPerFloor * plan.windowsPerRoom)}</p>
      </>}
    </fieldset>
    {error !== null && <p role="alert" className="notice notice-error">{problem(error)}</p>}
    <div className="form-actions"><button className="button" type="submit" disabled={busy || !form.companyId || !form.name.trim()}>{busy ? p.creating : p.create}</button></div>
  </form>;
}
