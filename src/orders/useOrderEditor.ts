import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type B2bApi } from "../api/client";
import type { Calculation, OrderCapabilities, OrderDetail } from "../api/orders";
import { Intent } from "../companies/idempotency";
import { currencyLocked, emptyLine, emptyOrder, LatestCalculation, orderDraft, orderFields, orderPath, type LineDraft, type OrderDraft } from "./model";

export function useOrderEditor(api: B2bApi, id: string | undefined, companyId: string | undefined, capabilities: OrderCapabilities,
  canCompanyView: boolean, navigate: (path: string) => void, onDirty: (dirty: boolean) => void) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [draft, setDraft] = useState(() => emptyOrder(companyId)), [base, setBase] = useState(() => emptyOrder(companyId));
  const [loading, setLoading] = useState(!!id), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [fields, setFields] = useState<Record<string, string>>({}), [notice, setNotice] = useState<"saved" | "createdNoView" | "cancelled" | "">("");
  const [conflict, setConflict] = useState(false), [current, setCurrent] = useState<OrderDetail | null>(null);
  const [confirm, setConfirm] = useState<"finalize" | "cancel" | null>(null);
  const [calc, setCalc] = useState<{ fingerprint: string; value: Calculation } | null>(null);
  const [calcError, setCalcError] = useState<{ fingerprint: string; error: unknown } | null>(null);
  const intent = useRef(new Intent()), latest = useRef(new LatestCalculation()), lock = useRef(false), mounted = useRef(true);
  // A detail's older capability hint must never keep an action visible after the access gate revokes it.
  const caps = useMemo(() => Object.fromEntries(Object.entries(capabilities).map(([key, value]) =>
    [key, value && (detail?.capabilities[key as keyof OrderCapabilities] ?? true)])) as OrderCapabilities, [capabilities, detail?.capabilities]);
  const frozen = !!detail && detail.order.status !== "draft";
  const editable = !frozen && notice !== "createdNoView" && (id ? caps.canUpdate : caps.canCreate && canCompanyView);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(base), [draft, base]);
  const submitted = useMemo(() => orderFields(draft), [draft]);
  const fingerprint = useMemo(() => JSON.stringify({ currencyCode: submitted.currencyCode, lines: submitted.lines }), [submitted]);
  const calculation = frozen ? detail!.order.calculation : calc?.fingerprint === fingerprint ? calc.value : null;
  const calculationError = calcError?.fingerprint === fingerprint ? calcError.error : null;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirty(dirty || busy); return () => onDirty(false); }, [dirty, busy, onDirty]);
  const acceptDetail = useCallback((value: OrderDetail) => {
    const next = orderDraft(value.order);
    setDetail(value); setDraft(next); setBase(next);
    const fields = orderFields(next);
    setCalc({ fingerprint: JSON.stringify({ currencyCode: fields.currencyCode, lines: fields.lines }), value: value.order.calculation });
  }, []);
  const productionSubmitted = useCallback(() => setDetail(value => !value || value.order.productionSubmitted ? value : {
    ...value, order: { ...value.order, productionSubmitted: true }, capabilities: { ...value.capabilities, canCancel: false },
  }), []);
  useEffect(() => {
    if (!id) return;
    let active = true;
    api.getOrder(id).then(d => { if (active) acceptDetail(d); }, e => { if (active) setError(e); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, id, acceptDetail]);
  useEffect(() => {
    const gate = latest.current;
    const generation = gate.begin();
    if (frozen || !editable) return;
    const timer = setTimeout(() => {
      const payload = JSON.parse(fingerprint) as Pick<typeof submitted, "currencyCode" | "lines">;
      api.calculateOrder(payload).then(value => {
        if (gate.accept(generation) && mounted.current) { setCalc({ fingerprint, value }); setCalcError(null); }
      }, e => { if (gate.accept(generation) && mounted.current) setCalcError({ fingerprint, error: e }); });
    }, 250);
    return () => { clearTimeout(timer); gate.begin(); };
  }, [api, editable, frozen, fingerprint]);

  const change = useCallback((patch: Partial<OrderDraft>) => {
    if (lock.current || !editable) return;
    setDraft(d => ({ ...d, ...patch })); setNotice(""); setConfirm(null);
  }, [editable]);
  const changeLine = useCallback((uuid: string, field: keyof LineDraft, value: string) => {
    if (lock.current || !editable) return;
    setDraft(d => ({ ...d, lines: d.lines.map(l => l.id === uuid ? { ...l, [field]: value } : l) }));
    setNotice(""); setConfirm(null);
  }, [editable]);
  const lineAction = useCallback((uuid: string | null, action: "add" | "duplicate" | "remove" | "up" | "down") => {
    if (lock.current || !editable) return;
    setDraft(d => {
      const lines = [...d.lines], index = lines.findIndex(l => l.id === uuid);
      if (action === "add" && lines.length < 100) lines.push(emptyLine());
      if (index >= 0) {
        if (action === "duplicate" && lines.length < 100) lines.splice(index + 1, 0, { ...lines[index], id: crypto.randomUUID() });
        if (action === "remove") lines.splice(index, 1);
        const target = action === "up" ? index - 1 : action === "down" ? index + 1 : -1;
        if (target >= 0 && target < lines.length) [lines[index], lines[target]] = [lines[target], lines[index]];
      }
      return { ...d, lines };
    });
    setNotice(""); setConfirm(null);
  }, [editable]);

  async function mutate(action: "save" | "finalize" | "duplicate" | "cancel") {
    if (lock.current || conflict) return;
    if (action === "save" && (!editable || (!dirty && !!id))) return;
    if (action === "finalize" && (!detail || dirty || !calculation?.complete || !caps.canFinalize)) return;
    if (action === "cancel" && (!detail || dirty || !caps.canCancel)) return;
    if (action === "duplicate" && (!detail || dirty || !caps.canCreate || !caps.canView)) return;
    lock.current = true; setBusy(true); setError(null); setFields({});
    try {
      const version = detail?.order.version ?? 0;
      const payload = action === "save" ? { action, id, fields: submitted, version } : { action, id, version };
      const options = { idempotencyKey: intent.current.keyFor(payload) };
      const result = action === "save" ? (id ? await api.updateOrder(id, submitted, version, options) : await api.createOrder(submitted, options))
        : action === "finalize" ? await api.finalizeOrder(id!, version, options)
          : action === "cancel" ? await api.cancelOrder(id!, version, options) : await api.duplicateOrder(id!, version, options);
      if (!mounted.current) return;
      intent.current.done(); setConflict(false); setCurrent(null); setConfirm(null);
      if (result.detail) acceptDetail(result.detail); else setBase(draft);
      setNotice(action === "cancel" ? "cancelled" : result.detail ? "saved" : "createdNoView");
      onDirty(false);
      if ((!id || action === "duplicate") && result.detail) navigate(orderPath(result.orderId));
    } catch (e) {
      if (!mounted.current) return;
      setError(e);
      if (e instanceof ApiError) {
        setFields(e.fields);
        if (["ORDER_CHANGED", "ORDER_FINALIZED", "ORDER_CANCELLED"].includes(e.code)) setConflict(true);
      }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function loadCurrent() {
    if (!id || lock.current) return;
    lock.current = true; setBusy(true);
    try { setCurrent(await api.getOrder(id)); } catch (e) { setError(e); }
    finally { lock.current = false; setBusy(false); }
  }
  function resolveConflict(keepMine: boolean) {
    if (!current) return;
    if (keepMine) { setDetail(current); setBase(orderDraft(current.order)); }
    else acceptDetail(current);
    intent.current.done(); setConflict(false); setCurrent(null); setError(null); setFields({});
  }
  return { detail, draft, caps, loading, busy, dirty, frozen, editable, error, fields, notice, conflict, current, confirm,
    setConfirm, calculation, calculationError, currencyIsLocked: currencyLocked(submitted.lines, detail?.order.lines ?? []),
    change, changeLine, lineAction, mutate, loadCurrent, resolveConflict, productionSubmitted };
}
