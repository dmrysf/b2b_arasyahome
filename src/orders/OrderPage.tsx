import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { B2bApi } from "../api/client";
import type { CompanyDetail, CompanyListItem } from "../api/companies";
import type { OrderCapabilities, OrderDetail } from "../api/orders";
import { useI18n } from "../i18n/context";
import { OrderActivity } from "./OrderActivity";
import { FieldError, OrderLineEditor } from "./OrderLineEditor";
import { addressLabel, orderPath, snapshotOption, type OrderDraft } from "./model";
import { useOrderEditor } from "./useOrderEditor";
import { ProductionCard } from '../production/ProductionCard';
import type { ProductionCapabilities } from '../api/production';

export function OrderPage({ api, id, companyId, capabilities, productionCapabilities = { canView: false, canSubmit: false }, canCompanyView, navigate, onDirty }: {
  api: B2bApi; id?: string; companyId?: string; capabilities: OrderCapabilities; canCompanyView: boolean;
  productionCapabilities?: ProductionCapabilities;
  navigate: (path: string) => void; onDirty: (dirty: boolean) => void;
}) {
  const { t, problem, dateTime } = useI18n(), o = t.orders;
  const e = useOrderEditor(api, id, companyId, capabilities, canCompanyView, navigate, onDirty);
  const [company, setCompany] = useState<CompanyDetail | null>(null), [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [search, setSearch] = useState(""), [companyError, setCompanyError] = useState<unknown>(null);
  const editor = useRef<HTMLFormElement>(null);
  const focusNewLine = useRef(false);
  // Focus within the DOM commit, before another field can receive user input.
  // A deferred animation-frame callback can steal focus from the next rapid edit.
  useLayoutEffect(() => {
    if (!focusNewLine.current) return;
    focusNewLine.current = false;
    editor.current?.querySelector<HTMLInputElement>(".order-line:last-child input")?.focus();
  }, [e.draft.lines]);
  useEffect(() => {
    if (!canCompanyView || !e.draft.companyId || e.frozen) return;
    let active = true;
    api.getCompany(e.draft.companyId).then(d => { if (active) { setCompany(d); setCompanyError(null); } }, error => { if (active) setCompanyError(error); });
    return () => { active = false; };
  }, [api, canCompanyView, e.draft.companyId, e.frozen]);
  useEffect(() => {
    if (id || !canCompanyView) return;
    let active = true;
    const timer = setTimeout(() => {
      api.listCompanies({ search, status: "active", limit: 50 }).then(d => { if (active) setCompanies(d.items); }, error => { if (active) setCompanyError(error); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [api, id, canCompanyView, search]);
  const addLine = () => {
    if (!e.editable || e.busy || e.draft.lines.length >= 100) return;
    focusNewLine.current = true;
    e.lineAction(null, "add");
  };
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest("dialog")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void e.mutate("save"); }
    else if (event.altKey && event.key === "Enter" && e.editable) { event.preventDefault(); addLine(); }
    else if (event.key === "Enter" && !event.defaultPrevented && event.target instanceof HTMLInputElement && event.target.closest(".order-line")) {
      const inputs = Array.from(editor.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".order-line input:not(:disabled), .order-line select:not(:disabled)") ?? [])
        .filter(input => input.getClientRects().length > 0);
      const index = inputs.indexOf(event.target);
      if (index >= 0 && index < inputs.length - 1) { event.preventDefault(); inputs[index + 1].focus(); }
    }
  });
  useEffect(() => {
    const element = editor.current;
    if (!element) return;
    const listener = (event: KeyboardEvent) => keyboard(event);
    element.addEventListener("keydown", listener);
    return () => element.removeEventListener("keydown", listener);
  }, [e.loading]);
  // A frozen (finalized/cancelled) order shows its historical snapshot, never live company records.
  const frozenOrder = e.frozen ? e.detail?.order : undefined;
  const selector = (key: "contactId" | "billingAddressId" | "deliveryAddressId", label: string, options: { id: string; label: string }[]) =>
    <label>{label}<select value={e.draft[key]} onChange={event => e.change({ [key]: event.target.value })}>
      <option value="">{o.none}</option>
      {e.draft[key] && !options.some(x => x.id === e.draft[key]) && <option value={e.draft[key]}>{o.unavailableSelection}</option>}
      {options.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
    </select><FieldError reason={e.fields[key]} /></label>;

  if (e.loading) return <p role="status">{o.loading}</p>;
  if (id && !e.detail) return <p role="alert">{problem(e.error)}</p>;
  if (!id && !e.editable && e.notice !== "createdNoView") return <section className="card"><h1>{o.noCreate}</h1></section>;
  const order = e.detail?.order;
  return <form className="page page-wide order-page" ref={editor} aria-label={o.workstation} onSubmit={event => event.preventDefault()}>
    <header className="page-header">
      <a className="back-link" href="/comenzi" onClick={event => { event.preventDefault(); navigate("/comenzi"); }}>← {o.title}</a>
      <p className="eyebrow">{o.workstation}</p><h1>{order?.code ?? o.newOrder}</h1>
      <div className="order-heading-meta"><span className={`badge status-${order?.status ?? "draft"}`}>{o[order?.status ?? "draft"]}</span>
        {order && <span>{o.version} {order.version} · {dateTime(order.updatedAt)}</span>}
        {e.dirty && <span className="unsaved-dot" role="status">{o.unsavedState}</span>}
      </div>
      {order?.origin && <a className="order-origin" href={`/proiecte/${order.origin.projectId}`} onClick={event => { event.preventDefault(); navigate(`/proiecte/${order.origin!.projectId}`); }}>
        {t.projects.origin(order.origin.projectCode)} · {order.origin.projectName}</a>}
      {order?.sourceOrderId && <a href={orderPath(order.sourceOrderId)} onClick={event => { event.preventDefault(); navigate(orderPath(order.sourceOrderId!)); }}>{o.source}</a>}
    </header>
    {order && <ProductionCard key={order.id} api={api} order={order} capabilities={productionCapabilities} disabled={e.busy || e.dirty || e.conflict} onSubmitted={e.productionSubmitted} />}
    {e.notice && <p className="notice notice-success order-success" role="status">{o[e.notice]}</p>}
    {e.error !== null && <p className="notice notice-error" role="alert">{problem(e.error)}</p>}
    {e.conflict && <section className="card notice notice-warning">
      <p>{o.conflict}</p><button className="button button-secondary" type="button" disabled={e.busy} onClick={() => void e.loadCurrent()}>{o.viewCurrent}</button>
      {e.current && <div data-testid="current-order"><h2>{o.current}</h2><p>{e.current.order.code} · {o[e.current.order.status]} · {o.version} {e.current.order.version}</p>
        <p>{e.current.order.lines.map(line => line.productCode).join(" · ")}</p><p>{e.current.order.notes}</p>
        <button type="button" className="button button-secondary" onClick={() => e.resolveConflict(false)}>{o.useServer}</button>
        {e.current.order.status === "draft" && e.current.order.currencyCode === e.draft.currencyCode && e.caps.canUpdate &&
          <button type="button" className="button" onClick={() => e.resolveConflict(true)}>{o.keepMine}</button>}
      </div>}
    </section>}
    <fieldset disabled={e.busy || !e.editable} className="order-fields">
      <section className="card order-header-fields"><h2>{o.company}</h2>
        {!id ? <div className="grid-2">
          <label>{o.companySearch}<input value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label>{o.company}<select value={e.draft.companyId} onChange={event => { setCompany(null); e.change({ companyId: event.target.value, contactId: "", billingAddressId: "", deliveryAddressId: "" }); }}>
            <option value="">{o.selectCompany}</option>
            {e.draft.companyId && !companies.some(c => c.id === e.draft.companyId) && <option value={e.draft.companyId}>{company?.company.legalName ?? o.loading}</option>}
            {companies.map(c => <option value={c.id} key={c.id}>{c.legalName} · {c.code}</option>)}
          </select><FieldError reason={e.fields.companyId} /></label>
        </div> : <CompanySnapshot detail={e.detail!} />}
        {companyError !== null && <p role="alert">{problem(companyError)}</p>}
        <div className="grid-3">
          <label>{o.currency}<select value={e.draft.currencyCode} disabled={e.currencyIsLocked} onChange={event => e.change({ currencyCode: event.target.value as OrderDraft["currencyCode"] })}>
            <option value="RON">RON</option><option value="EUR">EUR</option></select></label>
          <label>{o.customerReference}<input maxLength={160} value={e.draft.customerReference} onChange={event => e.change({ customerReference: event.target.value })} /><FieldError reason={e.fields.customerReference} /></label>
          {selector("contactId", o.contact, frozenOrder ? snapshotOption(frozenOrder.contactSnapshot, "contact") :
            (company?.contacts ?? []).filter(c => c.status === "active").map(c => ({ id: c.id, label: c.name })))}
          {selector("billingAddressId", o.billing, frozenOrder ? snapshotOption(frozenOrder.billingAddressSnapshot, "address") :
            (company?.addresses ?? []).filter(a => a.status === "active" && a.type === "billing").map(a => ({ id: a.id, label: addressLabel(a) })))}
          {selector("deliveryAddressId", o.delivery, frozenOrder ? snapshotOption(frozenOrder.deliveryAddressSnapshot, "address") :
            (company?.addresses ?? []).filter(a => a.status === "active" && a.type === "delivery").map(a => ({ id: a.id, label: addressLabel(a) })))}
        </div>
        {e.currencyIsLocked && !e.frozen && <p className="muted">{o.currencyHint}</p>}
        <div className="grid-2">{(["notes", "productionNotes"] as const).map(key => <label key={key}>{o[key]}<textarea maxLength={2000} value={e.draft[key]} onChange={event => e.change({ [key]: event.target.value })} /><FieldError reason={e.fields[key]} /></label>)}</div>
      </section>
      <section className="order-lines"><div className="order-section-title"><div><h2>{o.lines} <span className="count">{e.draft.lines.length}</span></h2><p className="muted">{o.measureHint}</p></div>
        {e.editable && <button className="button button-secondary" type="button" disabled={e.draft.lines.length >= 100} onClick={addLine}>{o.addLine}</button>}
      </div><FieldError reason={e.fields.lines} />
        {e.draft.lines.map((line, index) => <OrderLineEditor key={line.id} line={line} index={index} count={e.draft.lines.length} editable={e.editable} origin={order?.origin?.lines[line.id] ?? null}
          fields={e.fields} totals={e.calculation?.lines[index]?.totals ?? null} currency={e.draft.currencyCode} onChange={e.changeLine} onAction={e.lineAction} />)}
        {e.draft.lines.length === 0 && <div className="card empty-lines">{o.firstLine}</div>}
      </section>
    </fieldset>
    {e.frozen && <section className="card"><h2>{o.readOnly}</h2><p>{o.snapshotHint}</p>
      <p>{o.created}: {dateTime(order!.createdAt)} · {order!.createdBy.displayName}</p>
      {order!.finalizedAt && <p>{o.finalized}: {dateTime(order!.finalizedAt)} · {order!.finalizedBy?.displayName}</p>}
      {order!.cancelledAt && <p>{o.cancelled}: {dateTime(order!.cancelledAt)} · {order!.updatedBy.displayName}</p>}
      {[["contactSnapshot", o.contact], ["billingAddressSnapshot", o.billing], ["deliveryAddressSnapshot", o.delivery]].map(([key, label]) => {
        const snapshot = order![key as "contactSnapshot" | "billingAddressSnapshot" | "deliveryAddressSnapshot"];
        return snapshot ? <div key={key}><h3>{label}</h3><p>{Object.entries(snapshot).filter(([key, v]) => key !== "id" && key !== "type" && typeof v === "string").map(([, v]) => String(v)).join(" · ")}</p></div> : null;
      })}
    </section>}
    <section className="card order-footer" data-testid="order-totals">
      <div aria-live="polite">{e.calculation?.totals ? <dl className="order-summary">{(["net", "vat", "gross"] as const).map(k => <div key={k}><dt>{o[k]}</dt><dd>{e.calculation!.totals![k]} <small>{e.draft.currencyCode}</small></dd></div>)}</dl>
        : <p>{e.calculationError !== null ? problem(e.calculationError) : e.calculation ? o.incomplete : o.pending}</p>}</div>
      <div className="order-actions">
        {e.editable && <button type="button" className="button" disabled={e.busy || e.conflict || !e.draft.companyId || (!!id && !e.dirty)} onClick={() => void e.mutate("save")}>{e.busy ? t.common.saving : o.save}</button>}
        {id && e.caps.canFinalize && !e.frozen && <button type="button" className="button button-secondary" disabled={e.busy || e.dirty || e.conflict || !e.calculation?.complete} onClick={() => e.setConfirm("finalize")}>{o.finalize}</button>}
        {id && e.caps.canCancel && !order?.productionSubmitted && order?.status !== "cancelled" && <button type="button" className="button button-ghost" disabled={e.busy || e.dirty || e.conflict} onClick={() => e.setConfirm("cancel")}>{o.cancelOrder}</button>}
        {id && e.caps.canCreate && e.caps.canView && <button type="button" className="button button-secondary" disabled={e.busy || e.dirty || e.conflict} onClick={() => void e.mutate("duplicate")}>{o.duplicate}</button>}
      </div>
      {!e.frozen && <p className="muted keyboard-hint">{o.keyboardHint}</p>}
    </section>
    {e.confirm && e.detail && <OrderConfirmation detail={e.detail} action={e.confirm} busy={e.busy} onConfirm={() => void e.mutate(e.confirm!)} onClose={() => e.setConfirm(null)} />}
    {id && e.caps.canView && <OrderActivity api={api} id={id} version={order!.version} />}
  </form>;
}

function CompanySnapshot({ detail }: { detail: OrderDetail }) {
  const s = detail.order.companySnapshot;
  return <div className="order-snapshot"><strong>{String(s.legalName ?? "")}</strong>
    <p>{[s.companyCode, s.displayName, s.countryCode, s.taxIdentifier, s.vatNumber, s.registrationNumber].filter(Boolean).join(" · ")}</p></div>;
}

function OrderConfirmation({ detail, action, busy, onConfirm, onClose }: {
  detail: OrderDetail; action: "finalize" | "cancel"; busy: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const { t } = useI18n(), o = t.orders, dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!, focused = document.activeElement;
    element.showModal();
    return () => { element.close(); if (focused instanceof HTMLElement && focused.isConnected) focused.focus(); };
  }, []);
  return <dialog className="order-dialog" ref={dialog} aria-labelledby="order-confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="order-confirm-title">{action === "finalize" ? o.finalizeQuestion : o.cancelQuestion}</h2>
    <CompanySnapshot detail={detail} />
    <p>{detail.order.code} · {o.lineCount(detail.order.lines.length)} · {detail.order.currencyCode}</p>
    <dl className="order-summary">{(["net", "vat", "gross"] as const).map(k => <div key={k}><dt>{o[k]}</dt><dd>{detail.order.calculation.totals?.[k] ?? "—"} {detail.order.currencyCode}</dd></div>)}</dl>
    <p>{action === "finalize" ? o.freezeHint : o.cancelHint}</p><p className="muted">{o.productionBoundary}</p>
    <div className="order-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>{o.cancel}</button>
      <button type="button" className="button" disabled={busy} onClick={onConfirm}>{action === "finalize" ? o.confirmFinalize : o.confirmCancel}</button></div>
  </dialog>;
}
