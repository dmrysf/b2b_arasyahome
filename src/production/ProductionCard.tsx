import { useCallback, useEffect, useRef, useState } from 'react';
import type { B2bApi } from '../api/client';
import type { Order } from '../api/orders';
import type { Production, ProductionCapabilities } from '../api/production';
import { Intent } from '../companies/idempotency';
import { useI18n } from '../i18n/context';

export function ProductionCard({ api, order, capabilities, disabled, onSubmitted }: {
  api: B2bApi; order: Order; capabilities: ProductionCapabilities; disabled: boolean; onSubmitted: () => void;
}) {
  const { t, stageLabel, problem, dateTime } = useI18n(), p = t.production;
  const [production, setProduction] = useState<Production | null>(null), [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(capabilities.canView);
  const lock = useRef(false), generation = useRef(0), mounted = useRef(true), intent = useRef(new Intent());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = useCallback(async () => {
    if (!capabilities.canView || lock.current) return;
    const current = ++generation.current;
    setLoading(true); setError(null);
    try {
      const value = await api.getProduction(order.id);
      if (mounted.current && current === generation.current) { setProduction(value); if (value.submitted) onSubmitted(); }
    } catch (error) { if (mounted.current && current === generation.current) setError(error); }
    finally { if (mounted.current && current === generation.current) setLoading(false); }
  }, [api, order.id, capabilities.canView, onSubmitted]);
  useEffect(() => {
    if (!capabilities.canView) return;
    let active = true;
    const current = ++generation.current;
    api.getProduction(order.id).then(value => {
      if (active && current === generation.current) { setProduction(value); if (value.submitted) onSubmitted(); }
    }, error => { if (active && current === generation.current) setError(error); })
      .finally(() => { if (active && current === generation.current) setLoading(false); });
    return () => { active = false; };
  }, [api, order.id, order.status, capabilities.canView, onSubmitted]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const submitted = order.productionSubmitted || production?.submitted;
  const canSubmit = capabilities.canSubmit && order.status === 'finalized' && !submitted && !disabled && !busy && !loading && (!capabilities.canView || production !== null);
  async function submit() {
    if (!canSubmit || lock.current) return;
    lock.current = true; ++generation.current; setBusy(true); setError(null);
    try {
      const value = await api.submitProduction(order.id, order.version, { idempotencyKey: intent.current.keyFor({ orderId: order.id, expectedVersion: order.version }) });
      if (!mounted.current) return;
      intent.current.done(); setProduction(value); setConfirm(false); onSubmitted();
    } catch (error) { if (mounted.current) setError(error); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  if (!capabilities.canView && !capabilities.canSubmit) return null;
  return <section className="card production-card" aria-labelledby="production-title">
    <div className="order-section-title"><h2 id="production-title">{p.title}</h2>
      {capabilities.canView && <button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void refresh()}>{p.refresh}</button>}
    </div>
    {loading && <p role="status">{p.loading}</p>}
    {error !== null && <p role="alert" className="notice notice-error">{problem(error)}</p>}
    <p className="badge">{submitted ? production?.submitted && production.completedAt ? p.completed : p.submitted : p.notSubmitted}</p>
    {capabilities.canView && production?.submitted && <>
      <h3>{stageLabel(production.stage)}</h3>
      <p>{p.progress(production.stage.ordinal, production.totalStages)}</p>
      <progress aria-label={p.title} max={production.totalStages} value={production.completedAt ? 14 : production.stage.ordinal} />
      <dl className="production-details">
        <div><dt>{p.sentAt}</dt><dd>{dateTime(production.submittedAt)}</dd></div>
        <div><dt>{p.changedAt}</dt><dd>{dateTime(production.stageChangedAt)}</dd></div>
        {production.completedAt && <div><dt>{p.finishedAt}</dt><dd>{dateTime(production.completedAt)}</dd></div>}
        <div><dt>{p.reference}</dt><dd>{production.operationalOrderId}</dd></div>
      </dl>
    </>}
    <p className="muted">{submitted ? p.cancelBlocked : order.status === 'draft' ? p.draftHint : order.status === 'cancelled' ? p.cancelledHint : p.hint}</p>
    <p className="muted">{p.operator}</p>
    {canSubmit && <button type="button" className="button" onClick={() => setConfirm(true)}>{p.submit}</button>}
    {confirm && <ProductionConfirmation order={order} busy={busy} error={error} onClose={() => setConfirm(false)} onConfirm={() => void submit()} />}
  </section>;
}
function ProductionConfirmation({ order, busy, error, onClose, onConfirm }: { order: Order; busy: boolean; error: unknown; onClose: () => void; onConfirm: () => void }) {
  const { t, problem } = useI18n(), p = t.production, dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!, focused = document.activeElement; element.showModal();
    return () => { element.close(); if (focused instanceof HTMLElement && focused.isConnected) focused.focus(); }; }, []);
  return <dialog ref={dialog} className="order-dialog" aria-labelledby="production-confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="production-confirm-title">{p.question}</h2>
    <p>{order.code} · {String(order.companySnapshot.legalName ?? '')} · {t.orders.lineCount(order.lines.length)}</p>
    <ul className="production-confirm-lines" aria-label={t.orders.lines}>{order.lines.map((line, index) => <li key={line.id ?? index}>
      <strong>{line.productCode}</strong> · {t.orders[line.kind]} · {t.orders.quantity}: {line.quantity}
      {line.meters !== null && <> · {t.orders.meters}: {line.meters}</>}
      {line.width !== null && <> · {t.orders.width}: {line.width}</>}
      {line.height !== null && <> · {t.orders.height}: {line.height}</>}
    </li>)}</ul>
    {order.productionNotes && <p>{t.orders.productionNotes}: {order.productionNotes}</p>}
    <p>{p.warning}</p><p>{p.hint}</p><p className="muted">{p.operator}</p>
    {error !== null && <p role="alert">{problem(error)}</p>}
    <div className="order-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onClose}>{p.cancel}</button>
      <button type="button" className="button" disabled={busy} onClick={onConfirm}>{busy ? p.sending : p.confirm}</button></div>
  </dialog>;
}
