import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { B2bApi } from "../api/client";
import { MOUNTINGS, OPENING_TYPES, PANEL_LAYOUTS, PROPERTY_TYPES, TREATMENT_TYPES, type Opening, type ProjectActivity, type ProjectOperation, type ProjectOrder, type Scene, type Treatment, type Zone } from "../api/projects";
import { saveFile } from "../accounts/model";
import { Intent } from "../companies/idempotency";
import { useI18n } from "../i18n/context";
import { orderPath } from "../orders/model";
import { copyNames, emptyForm, fromForm, PROJECTS_PATH, projectPath, type Form } from "./model";
import { useProjectWorkspace, type Workspace } from "./useProjectWorkspace";
import { ElevationPreview } from "./ElevationPreview";

const ROOMS_PER_ZONE = 60;
const uuid = () => crypto.randomUUID();
type Dialog = null | { kind: "duplicateRoom" | "applyRoom" | "repeatOpening" | "copySet" | "convert" | "header" | "archive"; id?: string };

export function ProjectWorkspace({ api, id, roomId, navigate, onDirty }: {
  api: B2bApi; id: string; roomId: string | null; navigate: (path: string) => void; onDirty: (dirty: boolean) => void;
}) {
  const { t, problem, dateTime, locale } = useI18n(), p = t.projects;
  const ws = useProjectWorkspace(api, id, roomId, onDirty);
  const [dialog, setDialog] = useState<Dialog>(null), [busy, setBusy] = useState<string | null>(null), [actionError, setActionError] = useState<unknown>(null);
  const [navOpen, setNavOpen] = useState(false), [orders, setOrders] = useState<ProjectOrder[] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const detail = ws.detail, project = detail?.project;
  const editable = !!detail && detail.capabilities.canUpdate && project?.status !== "archived";
  useEffect(() => { api.getProjectOrders(id).then(setOrders, () => setOrders([])); }, [api, id, project?.revision]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void ws.flush(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ws]);
  const run = useCallback(async (label: string, ops: ProjectOperation[]) => {
    setBusy(label); setActionError(null);
    const ok = await ws.flush(ops);
    setBusy(null);
    return ok;
  }, [ws]);
  const select = (room: string) => { void ws.selectRoom(room); setNavOpen(false); window.history.replaceState(null, "", `${projectPath(id)}?camera=${room}`); };

  if (ws.loadError !== null) return <p role="alert" className="notice notice-error">{problem(ws.loadError)}</p>;
  if (!detail || !project) return <p role="status">{p.loading}</p>;
  const zones = detail.zones;
  const currentRoom = ws.room?.room ?? null;
  const roomTotal = ws.commercial?.zones.flatMap(z => z.rooms).find(r => r.id === currentRoom?.id);
  const download = async () => {
    setBusy("pdf"); setActionError(null);
    try {
      await ws.flush();
      const [file, current] = await Promise.all([api.proposalFile(id, locale), api.getProject(id)]);
      saveFile(file, `oferta-${project.code}-rev${current.project.revision}.pdf`);
      ws.setDetail(current);
    }
    catch (e) { setActionError(e); } finally { setBusy(null); }
  };
  const addZone = () => {
    const level = zones.length + 1;
    void run("zone", [{ op: "zone.create", id: uuid(), fields: { name: `${p.floorLabel} ${level}`, zoneType: "floor", level, building: null, notes: null } }]);
  };
  const addRoom = (zone: Zone) => {
    const room = uuid(), last = zone.rooms[zone.rooms.length - 1];
    const taken = zones.flatMap(z => z.rooms.map(r => r.name));
    const name = last ? copyNames(last.name, 1, undefined, 1, taken)[0] : copyNames(`${p.roomLabel}${zone.level !== null && zone.level >= 0 ? zone.level * 100 : 0}`, 1, undefined, 1, taken)[0];
    void run("room", [{ op: "room.create", id: room, zoneId: zone.id, fields: fromForm("room", emptyForm("room", name)) }]).then(ok => { if (ok) select(room); });
  };
  return <div className="page page-wide project-workspace-page" ref={root}>
    <header className="page-header page-header-actions project-header">
      <div>
        <a className="back-link" href={PROJECTS_PATH} onClick={e => { e.preventDefault(); navigate(PROJECTS_PATH); }}>← {p.back}</a>
        <p className="eyebrow">{project.code} · {p.types[project.propertyType]}</p>
        <h1>{project.name}</h1>
        <p>{project.company.legalName} · {project.company.code}{project.siteAddress ? ` · ${project.siteAddress}` : ""}</p>
        <div className="order-heading-meta"><span className={`badge status-${project.status}`}>{p.statuses[project.status]}</span>
          <span>{p.rooms(project.counts.rooms)} · {p.openings(project.counts.openings)} · {p.treatmentsCount(project.counts.treatments)}</span></div>
      </div>
      <div className="project-actions">
        <SaveIndicator ws={ws} />
        {editable && <button type="button" className="button button-secondary" disabled={ws.state === "saving" || (!ws.dirty && ws.state !== "retrying")} onClick={() => void ws.flush()}>{p.save}</button>}
        <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => void download()}>{busy === "pdf" ? p.downloading : p.proposal}</button>
        {detail.capabilities.canConvert && project.status !== "archived" && <button type="button" className="button" disabled={busy !== null} onClick={() => { void ws.flush().then(() => setDialog({ kind: "convert" })); }}>{p.convert}</button>}
      </div>
    </header>
    {project.status === "archived" && <p className="notice notice-warning">{p.readOnly}</p>}
    {ws.state === "conflict" && <section className="card notice notice-warning" role="alert"><p>{p.conflictBody}</p><div className="form-actions">
      <button type="button" className="button" onClick={() => void ws.resolveConflict(true)}>{p.keepMine}</button>
      <button type="button" className="button button-secondary" onClick={() => void ws.resolveConflict(false)}>{p.useServer}</button></div></section>}
    {ws.error !== null && ws.state !== "conflict" && <p role="alert" className="notice notice-error">{problem(ws.error)}</p>}
    {actionError !== null && <p role="alert" className="notice notice-error">{problem(actionError)}</p>}
    <div className="project-workspace">
      <aside className={`card project-navigator ${navOpen ? "open" : ""}`} aria-label={p.navigator}>
        <button type="button" className="button button-secondary navigator-toggle" aria-expanded={navOpen} onClick={() => setNavOpen(v => !v)}>
          {p.navigator}: {currentRoom ? (ws.forms[currentRoom.id]?.name ?? currentRoom.name) : p.selectRoom}</button>
        <Navigator ws={ws} zones={zones} editable={editable} current={ws.roomId} onSelect={select} onAddRoom={addRoom} onAddZone={addZone} busy={busy !== null} />
      </aside>
      <section className="project-room" aria-label={p.room}>
        {!currentRoom ? <div className="card empty-lines">{zones.length === 0 ? p.noRooms : p.selectRoom}</div> :
          <RoomEditor key={currentRoom.id} api={api} projectId={id} ws={ws} editable={editable} busy={busy} run={run} onDialog={setDialog}
            onRemoved={() => { const next = zones.flatMap(z => z.rooms).find(r => r.id !== currentRoom.id); if (next) select(next.id); }} />}
      </section>
    </div>
    <div className="grid-2">
      <section className="card" aria-labelledby="commercial-title">
        <h2 id="commercial-title">{p.commercial}</h2>
        <p className="muted">{p.commercialHint}</p>
        <dl className="order-summary">
          {roomTotal && <div><dt>{p.roomTotal}</dt><dd>{roomTotal.totals?.gross ?? "—"} <small>{project.currencyCode}</small></dd></div>}
          <div><dt>{p.projectTotal} · {p.net}</dt><dd>{ws.commercial?.totals?.net ?? "—"} <small>{project.currencyCode}</small></dd></div>
          <div><dt>{p.projectTotal}</dt><dd>{ws.commercial?.totals?.gross ?? "—"} <small>{project.currencyCode}</small></dd></div>
        </dl>
        {ws.commercial && !ws.commercial.complete && ws.commercial.treatmentCount > 0 && <p className="muted">{p.incomplete}</p>}
      </section>
      <section className="card" aria-labelledby="project-orders-title">
        <h2 id="project-orders-title">{p.orders}</h2>
        {orders === null ? <p role="status">{p.loading}</p> : orders.length === 0 ? <p className="muted">{p.noOrders}</p> :
          <ul className="project-orders">{orders.map(o => <li key={o.orderId}>
            <a className="order-code mono" href={orderPath(o.orderId)} onClick={e => { e.preventDefault(); navigate(orderPath(o.orderId)); }}>{o.code}</a>
            <span className={`badge status-${o.status}`}>{t.orders[o.status]}</span><span>{t.orders.lineCount(o.lineCount)}</span>
            <span className="muted">{o.totals?.gross ?? "—"} {o.currencyCode} · {dateTime(o.createdAt)}</span></li>)}</ul>}
        <div className="form-actions">
          {detail.capabilities.canUpdate && project.status !== "archived" && <button type="button" className="button button-ghost" onClick={() => setDialog({ kind: "header" })}>{p.edit}</button>}
          {project.status === "draft" && detail.capabilities.canUpdate && <StatusButton api={api} ws={ws} status="active" label={p.activate} />}
          {project.status !== "archived" && detail.capabilities.canArchive && <button type="button" className="button button-ghost" onClick={() => setDialog({ kind: "archive" })}>{p.archive}</button>}
          {project.status === "archived" && detail.capabilities.canArchive && <StatusButton api={api} ws={ws} status="active" label={p.reactivate} />}
        </div>
      </section>
    </div>
    <ActivityPanel api={api} id={id} revision={project.revision} />
    {dialog?.kind === "convert" && <ConvertDialog api={api} ws={ws} onClose={() => setDialog(null)} onCreated={orderId => { setDialog(null); navigate(orderPath(orderId)); }} />}
    {dialog?.kind === "header" && <HeaderDialog api={api} ws={ws} onClose={() => setDialog(null)} />}
    {dialog?.kind === "archive" && <Confirm title={p.archiveQuestion} confirm={p.archive} onClose={() => setDialog(null)} onConfirm={async () => {
      const result = await api.setProjectStatus(id, "archived", project.version, { idempotencyKey: crypto.randomUUID() });
      if (result.detail) ws.setDetail(result.detail);
      setDialog(null);
    }} />}
    {dialog && ["duplicateRoom", "applyRoom", "repeatOpening", "copySet"].includes(dialog.kind) && currentRoom &&
      <RepeatDialog kind={dialog.kind as "duplicateRoom" | "applyRoom" | "repeatOpening" | "copySet"} sourceId={dialog.id!} ws={ws} zones={zones}
        onClose={() => setDialog(null)} onApply={async ops => { const ok = await run("repeat", ops); if (ok) setDialog(null); return ok; }} />}
  </div>;
}

function SaveIndicator({ ws }: { ws: Workspace }) {
  const { t } = useI18n(), p = t.projects;
  const state = ws.dirty && ws.state === "saved" ? "dirty" : ws.state;
  return <p className={`save-state save-${state}`} role="status" aria-live="polite"><span aria-hidden="true" />{p.saveStates[state]}</p>;
}

/** Zones and rooms. Long zones render the first rooms and expand on demand; a filter searches all rooms. */
const Navigator = memo(function Navigator({ ws, zones, editable, current, onSelect, onAddRoom, onAddZone, busy }: {
  ws: Workspace; zones: Zone[]; editable: boolean; current: string | null; onSelect: (id: string) => void; onAddRoom: (zone: Zone) => void; onAddZone: () => void; busy: boolean;
}) {
  const { t } = useI18n(), p = t.projects;
  const [filter, setFilter] = useState(""), [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const needle = filter.trim().toLocaleLowerCase();
  return <div className="navigator-body">
    <label className="sr-only" htmlFor="room-filter">{p.filterRooms}</label>
    <input id="room-filter" type="search" placeholder={p.filterRooms} value={filter} onChange={e => setFilter(e.target.value)} />
    {zones.map(zone => {
      const rooms = needle ? zone.rooms.filter(r => (ws.forms[r.id]?.name ?? r.name).toLocaleLowerCase().includes(needle)) : zone.rooms;
      const shown = needle || expanded[zone.id] ? rooms : rooms.slice(0, ROOMS_PER_ZONE);
      const form = ws.forms[zone.id];
      return <section key={zone.id} className="navigator-zone" aria-label={form?.name ?? zone.name}>
        <div className="navigator-zone-head">
          {editable ? <input aria-label={p.zoneName} value={form?.name ?? zone.name} maxLength={120} onChange={e => ws.edit(zone.id, "name", e.target.value)} />
            : <strong>{zone.name}</strong>}
          <span className="count">{zone.rooms.length}</span>
        </div>
        <ul>{shown.map(room => <li key={room.id}>
          <button type="button" className={room.id === current ? "active" : ""} aria-current={room.id === current ? "true" : undefined} onClick={() => onSelect(room.id)}>
            <span>{ws.forms[room.id]?.name ?? room.name}</span><small>{room.openingCount}·{room.treatmentCount}{room.orderedCount > 0 ? " ✓" : ""}</small>
          </button></li>)}</ul>
        {!needle && !expanded[zone.id] && rooms.length > ROOMS_PER_ZONE &&
          <button type="button" className="button button-ghost" onClick={() => setExpanded(e => ({ ...e, [zone.id]: true }))}>{p.showAll(rooms.length)}</button>}
        {editable && <button type="button" className="button button-ghost" disabled={busy} onClick={() => onAddRoom(zone)}>+ {p.addRoom}</button>}
      </section>;
    })}
    {editable && <button type="button" className="button button-secondary" disabled={busy} onClick={onAddZone}>+ {p.addFloor}</button>}
  </div>;
});

function Input({ ws, id, field, label, numeric, editable, wide, options, multiline }: {
  ws: Workspace; id: string; field: string; label: string; numeric?: boolean; editable: boolean; wide?: boolean; options?: [string, string][]; multiline?: boolean;
}) {
  const { t } = useI18n();
  const value = ws.forms[id]?.[field] ?? "", error = ws.fieldErrors[`${id}.${field}`];
  const common = { "aria-invalid": !!error, disabled: !editable, id: `${id}-${field}` };
  let control: ReactNode;
  if (options) control = <select {...common} value={value} onChange={e => ws.edit(id, field, e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  else if (multiline) control = <textarea {...common} value={value} maxLength={2000} onChange={e => ws.edit(id, field, e.target.value)} />;
  else control = <input {...common} value={value} inputMode={numeric ? "decimal" : undefined} maxLength={numeric ? 16 : 160} onChange={e => ws.edit(id, field, e.target.value)} />;
  return <label className={wide ? "span-2" : undefined} htmlFor={`${id}-${field}`}>{label}{control}
    {error && <span className="field-error" role="alert">{error === "required" ? t.orders.fieldRequired : error === "too_long" ? t.orders.fieldLong : t.orders.fieldInvalid}</span>}</label>;
}

function RoomEditor({ api, projectId, ws, editable, busy, run, onDialog, onRemoved }: {
  api: B2bApi; projectId: string; ws: Workspace; editable: boolean; busy: string | null; run: (label: string, ops: ProjectOperation[]) => Promise<boolean>;
  onDialog: (dialog: Dialog) => void; onRemoved: () => void;
}) {
  const { t } = useI18n(), p = t.projects;
  const room = ws.room!.room;
  const [scene, setScene] = useState<Scene | null>(null);
  useEffect(() => {
    let active = true;
    api.getProjectScene(projectId, room.id).then(v => { if (active) setScene(v); }, () => { if (active) setScene(null); });
    return () => { active = false; };
  }, [api, projectId, room.id, ws.savedAt, ws.room]);
  const remove = async (level: "room" | "opening" | "treatment", nodeId: string, name: string) => {
    if (!window.confirm(p.confirmRemove(name))) return;
    const ok = await run("remove", [{ op: `${level}.remove`, id: nodeId, expectedVersion: ws.version(nodeId) } as ProjectOperation]);
    if (ok && level === "room") onRemoved();
  };
  const addOpening = () => void run("opening", [{ op: "opening.create", id: uuid(), roomId: room.id, fields: fromForm("opening", emptyForm("opening", copyNames(`${p.windowLabel} 0`, 1, undefined, 1, room.openings.map(o => ws.forms[o.id]?.name || o.name))[0])) }]);
  const I = (field: string, label: string, numeric = false, wide = false) => <Input ws={ws} id={room.id} field={field} label={label} numeric={numeric} editable={editable} wide={wide} />;
  return <div className="room-editor">
    <section className="card room-card">
      <div className="order-section-title"><h2>{ws.forms[room.id]?.name || room.name}</h2>
        {editable && <div className="row-actions">
          <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => onDialog({ kind: "duplicateRoom", id: room.id })}>{p.duplicateRoom}</button>
          <button type="button" className="button button-secondary" disabled={busy !== null || room.openings.length === 0} onClick={() => onDialog({ kind: "applyRoom", id: room.id })}>{p.applyRoom}</button>
          <button type="button" className="button button-danger-ghost" disabled={busy !== null} onClick={() => void remove("room", room.id, room.name)}>{p.remove}</button>
        </div>}
      </div>
      <div className="project-grid">{I("name", p.roomName)}{I("widthCm", p.widthCm, true)}{I("lengthCm", p.lengthCm, true)}{I("ceilingHeightCm", p.ceilingHeightCm, true)}{I("notes", p.roomNotes, false, true)}</div>
    </section>
    <div className="order-section-title"><h2>{p.openings_} <span className="count">{room.openings.length}</span></h2>
      {editable && <button type="button" className="button button-secondary" disabled={busy !== null} onClick={addOpening}>+ {p.addOpening}</button>}</div>
    {room.openings.map(opening => <OpeningCard key={opening.id} ws={ws} opening={opening} editable={editable} busy={busy} run={run} onDialog={onDialog} onRemove={remove}
      scene={scene?.rooms[0]?.openings.find(o => o.id === opening.id) ?? null} revision={scene?.revision ?? null} />)}
  </div>;
}

function OpeningCard({ ws, opening, editable, busy, run, onDialog, onRemove, scene, revision }: {
  ws: Workspace; opening: Opening; editable: boolean; busy: string | null; run: (label: string, ops: ProjectOperation[]) => Promise<boolean>;
  onDialog: (dialog: Dialog) => void; onRemove: (level: "opening" | "treatment", id: string, name: string) => Promise<void>; scene: Scene["rooms"][number]["openings"][number] | null;
  revision: number | null;
}) {
  const { t } = useI18n(), p = t.projects;
  const I = (field: string, label: string, numeric = false, options?: [string, string][]) => <Input ws={ws} id={opening.id} field={field} label={label} numeric={numeric} editable={editable} options={options} />;
  const name = ws.forms[opening.id]?.name || opening.name;
  return <article className="card opening-card" aria-label={name}>
    <div className="order-section-title"><h3>{name}</h3>
      {editable && <div className="row-actions">
        <button type="button" className="button button-ghost" disabled={busy !== null} onClick={() => onDialog({ kind: "repeatOpening", id: opening.id })}>{p.repeatOpening}</button>
        <button type="button" className="button button-ghost" disabled={busy !== null || opening.treatments.length === 0} onClick={() => onDialog({ kind: "copySet", id: opening.id })}>{p.copySet}</button>
        <button type="button" className="button button-danger-ghost" disabled={busy !== null} onClick={() => void onRemove("opening", opening.id, name)}>{p.remove}</button>
      </div>}
    </div>
    <div className="opening-layout">
      <div className="project-grid">
        {I("name", p.openingName)}{I("openingType", p.openingType, false, OPENING_TYPES.map(v => [v, p.openingTypes[v]]))}
        {I("width", p.width, true)}{I("height", p.height, true)}{I("sillHeight", p.sillHeight, true)}{I("wallIndex", p.wallIndex, true)}
        {I("offsetLeft", p.offsetLeft, true)}{I("wallWidth", p.wallWidth, true)}
        {I("mounting", p.mounting, false, [["", p.none], ...MOUNTINGS.map(v => [v, p.mountings[v]] as [string, string])])}{I("railType", p.railType)}
      </div>
      <ElevationPreview opening={scene} revision={revision} />
    </div>
    <h4>{p.treatments}</h4>
    {opening.treatments.map(treatment => <TreatmentRow key={treatment.id} ws={ws} treatment={treatment} editable={editable} busy={busy} run={run} onRemove={onRemove} />)}
    {editable && <button type="button" className="button button-secondary" disabled={busy !== null || opening.treatments.length >= 12}
      onClick={() => void run("treatment", [{ op: "treatment.create", id: uuid(), openingId: opening.id, fields: fromForm("treatment", emptyForm("treatment")) }])}>+ {p.addTreatment}</button>}
  </article>;
}

function TreatmentRow({ ws, treatment, editable, busy, run, onRemove }: {
  ws: Workspace; treatment: Treatment; editable: boolean; busy: string | null; run: (label: string, ops: ProjectOperation[]) => Promise<boolean>;
  onRemove: (level: "opening" | "treatment", id: string, name: string) => Promise<void>;
}) {
  const { t } = useI18n(), p = t.projects, o = t.orders;
  const I = (field: string, label: string, numeric = false, options?: [string, string][]) => <Input ws={ws} id={treatment.id} field={field} label={label} numeric={numeric} editable={editable} options={options} />;
  const form = ws.forms[treatment.id] ?? {};
  return <div className="treatment-row" data-treatment-id={treatment.id}>
    <div className="treatment-head">
      <strong>{p.treatmentTypes[(form.treatmentType || treatment.treatmentType) as Treatment["treatmentType"]]}{form.productCode ? ` · ${form.productCode}` : ""}</strong>
      {treatment.ordered && <span className="badge badge-success">{p.ordered(treatment.ordered.orderCode)}</span>}
      <span className="treatment-total">{treatment.totals?.gross ?? "—"}</span>
      {editable && <span className="row-actions">
        <button type="button" className="button button-ghost" disabled={busy !== null} onClick={() => void run("duplicate", [{ op: "treatment.duplicate", id: treatment.id }])}>{p.duplicate}</button>
        <button type="button" className="button button-danger-ghost" disabled={busy !== null} onClick={() => void onRemove("treatment", treatment.id, form.productCode || p.treatmentTypes[treatment.treatmentType])}>{p.remove}</button>
      </span>}
    </div>
    <div className="treatment-grid">
      {I("treatmentType", p.treatmentType, false, TREATMENT_TYPES.map(v => [v, p.treatmentTypes[v]]))}
      {I("panelLayout", p.panelLayout, false, [["", p.none], ...PANEL_LAYOUTS.map(v => [v, p.panelLayouts[v]] as [string, string])])}
      {I("productCode", o.productCode)}{I("productName", o.productName)}{I("color", o.color)}{I("variant", o.variant)}
      {I("width", o.width, true)}{I("height", o.height, true)}{I("quantity", o.quantity, true)}{I("meters", o.meters, true)}
      {I("pricingUnit", o.pricingUnit, false, [["meter", o.meter], ["piece", o.piece]])}{I("unitPriceNet", p.unitPriceNet, true)}{I("discountPercent", p.discountPercent, true)}{I("vatPercent", p.vatPercent, true)}
    </div>
    <details><summary>{o.lineNotes}</summary><div className="grid-2">
      <Input ws={ws} id={treatment.id} field="notes" label={o.lineNotes} editable={editable} multiline />
      <Input ws={ws} id={treatment.id} field="productionNotes" label={o.productionNotes} editable={editable} multiline /></div></details>
  </div>;
}

function Modal({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!, focused = document.activeElement;
    element.showModal();
    return () => { element.close(); if (focused instanceof HTMLElement && focused.isConnected) focused.focus(); };
  }, []);
  return <dialog ref={dialog} className="order-dialog project-dialog" aria-labelledby="project-dialog-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="project-dialog-title">{title}</h2>{children}
  </dialog>;
}

function Confirm({ title, confirm, onClose, onConfirm }: { title: string; confirm: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const { t, problem } = useI18n();
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  return <Modal title={title} onClose={onClose} busy={busy}>
    {error !== null && <p role="alert">{problem(error)}</p>}
    <div className="order-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>{t.projects.cancel}</button>
      <button type="button" className="button" disabled={busy} onClick={() => { setBusy(true); onConfirm().catch(setError).finally(() => setBusy(false)); }}>{confirm}</button></div>
  </Modal>;
}

/** Explicit copy tools. Every copy is a new independent node; the server applies the whole action atomically. */
function RepeatDialog({ kind, sourceId, ws, zones, onClose, onApply }: {
  kind: "duplicateRoom" | "applyRoom" | "repeatOpening" | "copySet"; sourceId: string; ws: Workspace; zones: Zone[];
  onClose: () => void; onApply: (ops: ProjectOperation[]) => Promise<boolean>;
}) {
  const { t } = useI18n(), p = t.projects;
  const room = ws.room!.room;
  const source = kind === "duplicateRoom" || kind === "applyRoom" ? { name: ws.forms[room.id]?.name || room.name } : room.openings.find(o => o.id === sourceId)!;
  const [count, setCount] = useState("19"), [first, setFirst] = useState(""), [zoneId, setZoneId] = useState(room.zoneId);
  const [targets, setTargets] = useState<string[]>([]), [mode, setMode] = useState<"replace" | "append">("replace"), [busy, setBusy] = useState(false);
  const n = Math.max(1, Math.min(200, Number(count) || 1));
  const taken = useMemo(() => kind === "repeatOpening" ? room.openings.map(o => ws.forms[o.id]?.name || o.name)
    : zones.flatMap(z => z.rooms.map(r => ws.forms[r.id]?.name || r.name)), [kind, room.openings, zones, ws.forms]);
  const names = useMemo(() => copyNames(source.name, n, first.trim() === "" ? undefined : Number(first), 1, taken), [source.name, n, first, taken]);
  const title = { duplicateRoom: p.duplicateRoomTitle, applyRoom: p.applyRoomTitle, repeatOpening: p.repeatOpeningTitle, copySet: p.copySetTitle }[kind](source.name);
  const candidates = kind === "applyRoom" ? zones.flatMap(z => z.rooms.filter(r => r.id !== room.id).map(r => ({ id: r.id, label: `${z.name} · ${r.name}` })))
    : kind === "copySet" ? room.openings.filter(o => o.id !== sourceId).map(o => ({ id: o.id, label: o.name })) : [];
  const toggle = (id: string) => setTargets(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]);
  const apply = async () => {
    setBusy(true);
    const ops: ProjectOperation[] = kind === "duplicateRoom" ? [{ op: "room.duplicate", id: sourceId, names, ...(zoneId !== room.zoneId ? { zoneId } : {}) }]
      : kind === "repeatOpening" ? [{ op: "opening.duplicate", id: sourceId, names }]
        : kind === "applyRoom" ? [{ op: "room.apply", sourceId, targetIds: targets, mode }] : [{ op: "treatment.copySet", sourceOpeningId: sourceId, targetOpeningIds: targets, mode }];
    await onApply(ops);
    setBusy(false);
  };
  return <Modal title={title} onClose={onClose} busy={busy}>
    {(kind === "duplicateRoom" || kind === "repeatOpening") && <>
      <div className="grid-2">
        <label>{p.copies}<input inputMode="numeric" value={count} onChange={e => setCount(e.target.value)} /></label>
        <label>{p.firstNumber}<input inputMode="numeric" value={first} placeholder={names[0]?.match(/\d+$/)?.[0] ?? ""} onChange={e => setFirst(e.target.value)} /></label>
      </div>
      {kind === "duplicateRoom" && <label>{p.targetZone}<select value={zoneId} onChange={e => setZoneId(e.target.value)}>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>}
      <p className="muted">{p.namesPreview}: {names.length <= 6 ? names.join(", ") : `${names.slice(0, 3).join(", ")} … ${names[names.length - 1]}`}</p>
    </>}
    {(kind === "applyRoom" || kind === "copySet") && <>
      <fieldset className="target-list"><legend>{kind === "applyRoom" ? p.selectTargets : p.selectOpenings}</legend>
        <label className="checkbox"><input type="checkbox" checked={targets.length === candidates.length && candidates.length > 0}
          onChange={e => setTargets(e.target.checked ? candidates.map(c => c.id) : [])} />{p.statuses.all}</label>
        {candidates.map(c => <label key={c.id} className="checkbox"><input type="checkbox" checked={targets.includes(c.id)} onChange={() => toggle(c.id)} />{c.label}</label>)}
      </fieldset>
      <p role="status">{p.selectedCount(targets.length)}</p>
      <label className="checkbox"><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} />{p.modeReplace}</label>
      <label className="checkbox"><input type="radio" name="mode" checked={mode === "append"} onChange={() => setMode("append")} />{p.modeAppend}</label>
    </>}
    <p className="muted">{p.independent}</p>
    <div className="order-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>{p.cancel}</button>
      <button type="button" className="button" disabled={busy || ((kind === "applyRoom" || kind === "copySet") && targets.length === 0)} onClick={() => void apply()}>{p.apply}</button></div>
  </Modal>;
}

/** Scope selection by room: every not-yet-ordered treatment of the chosen rooms, at most 100 per Classic order. */
function ConvertDialog({ api, ws, onClose, onCreated }: { api: B2bApi; ws: Workspace; onClose: () => void; onCreated: (orderId: string) => void }) {
  const { t, problem } = useI18n(), p = t.projects;
  const [rooms, setRooms] = useState<string[]>(ws.roomId ? [ws.roomId] : []), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const intent = useRef(new Intent());
  const treatments = ws.commercial?.treatments ?? [];
  const selected = treatments.filter(x => rooms.includes(x.roomId));
  const free = selected.filter(x => x.ordered === null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const ids = free.map(x => x.id), revision = ws.detail!.project.revision;
      onCreated(await api.convertProject(ws.detail!.project.id, ids, revision, { idempotencyKey: intent.current.keyFor({ ids, revision }) }));
    } catch (e) { setError(e); void ws.refresh(); } finally { setBusy(false); }
  };
  return <Modal title={p.convertTitle} onClose={onClose} busy={busy}>
    <p>{p.convertHint}</p>
    <fieldset className="target-list"><legend>{p.selectTargets}</legend>
      {ws.detail!.zones.map(z => <div key={z.id} className="target-zone"><label className="checkbox"><input type="checkbox"
        checked={z.rooms.length > 0 && z.rooms.every(r => rooms.includes(r.id))}
        onChange={e => setRooms(v => e.target.checked ? [...new Set([...v, ...z.rooms.map(r => r.id)])] : v.filter(id => !z.rooms.some(r => r.id === id)))} /><strong>{z.name}</strong></label>
        {z.rooms.map(r => <label key={r.id} className="checkbox"><input type="checkbox" checked={rooms.includes(r.id)} onChange={() => setRooms(v => v.includes(r.id) ? v.filter(x => x !== r.id) : [...v, r.id])} />
          {r.name} <small className="muted">{r.treatmentCount - r.orderedCount}/{r.treatmentCount}</small></label>)}</div>)}
    </fieldset>
    <p role="status"><strong>{p.convertSelected(free.length)}</strong>{selected.length > free.length && <> · {p.convertAlready(selected.length - free.length)}</>}</p>
    <p className="muted">{p.convertLimit}</p>
    {error !== null && <p role="alert" className="notice notice-error">{problem(error)}</p>}
    <div className="order-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>{p.cancel}</button>
      <button type="button" className="button" disabled={busy || free.length === 0 || free.length > 100} onClick={() => void submit()}>{busy ? p.converting : p.convertConfirm}</button></div>
  </Modal>;
}

function HeaderDialog({ api, ws, onClose }: { api: B2bApi; ws: Workspace; onClose: () => void }) {
  const { t, problem } = useI18n(), p = t.projects;
  const project = ws.detail!.project;
  const [form, setForm] = useState<Form>({ name: project.name, propertyType: project.propertyType, currencyCode: project.currencyCode, siteAddress: project.siteAddress ?? "",
    customerReference: project.customerReference ?? "", notes: project.notes ?? "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), intent = useRef(new Intent());
  const save = async () => {
    setBusy(true); setError(null);
    const body = { companyId: project.company.id, name: form.name.trim(), propertyType: form.propertyType as typeof project.propertyType, currencyCode: form.currencyCode as "RON" | "EUR",
      siteAddress: form.siteAddress.trim() || null, customerReference: form.customerReference.trim() || null, notes: form.notes.trim() || null };
    try {
      const result = await api.updateProject(project.id, body, project.version, { idempotencyKey: intent.current.keyFor(body) });
      if (result.detail) ws.setDetail(result.detail);
      onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const text = (key: string, label: string, max: number) => <label>{label}<input value={form[key]} maxLength={max} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} /></label>;
  return <Modal title={p.edit} onClose={onClose} busy={busy}>
    {text("name", p.name, 160)}
    <div className="grid-2"><label>{p.propertyType}<select value={form.propertyType} onChange={e => setForm(f => ({ ...f, propertyType: e.target.value }))}>
      {PROPERTY_TYPES.map(v => <option key={v} value={v}>{p.types[v]}</option>)}</select></label>
      <label>{p.currency}<select value={form.currencyCode} onChange={e => setForm(f => ({ ...f, currencyCode: e.target.value }))}><option>RON</option><option>EUR</option></select></label></div>
    {text("siteAddress", p.siteAddress, 300)}{text("customerReference", p.customerReference, 160)}
    <label>{p.notes}<textarea value={form.notes} maxLength={2000} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></label>
    {error !== null && <p role="alert" className="notice notice-error">{problem(error)}</p>}
    <div className="order-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>{p.cancel}</button>
      <button type="button" className="button" disabled={busy || !form.name.trim()} onClick={() => void save()}>{p.saveHeader}</button></div>
  </Modal>;
}

function StatusButton({ api, ws, status, label }: { api: B2bApi; ws: Workspace; status: "active"; label: string }) {
  const { problem } = useI18n();
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), intent = useRef(new Intent());
  const project = ws.detail!.project;
  return <>{error !== null && <span role="alert">{problem(error)}</span>}<button type="button" className="button button-ghost" disabled={busy} onClick={() => {
    setBusy(true); setError(null);
    api.setProjectStatus(project.id, status, project.version, { idempotencyKey: intent.current.keyFor({ status, version: project.version }) })
      .then(r => { if (r.detail) ws.setDetail(r.detail); }, setError).finally(() => setBusy(false));
  }}>{label}</button></>;
}

function ActivityPanel({ api, id, revision }: { api: B2bApi; id: string; revision: number }) {
  const { t, dateTime } = useI18n(), p = t.projects;
  const [open, setOpen] = useState(false), [items, setItems] = useState<ProjectActivity[] | null>(null);
  useEffect(() => { if (open) api.projectActivity(id).then(r => setItems(r.items), () => setItems([])); }, [api, id, open, revision]);
  return <details className="card" onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
    <summary><h2>{p.activity}</h2></summary>
    {items === null ? <p role="status">{p.loading}</p> : <ul className="timeline">{items.map(a => <li key={a.id}>
      <strong>{p.actions[a.action] ?? a.action}</strong> <span className="muted">{a.actor.displayName} · {dateTime(a.occurredAt)}</span></li>)}</ul>}
  </details>;
}
