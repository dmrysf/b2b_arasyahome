import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiError, type B2bApi } from "../api/client";
import type { Commercial, ProjectDetail, ProjectOperation, RoomDetail } from "../api/projects";
import { Intent } from "../companies/idempotency";
import { AUTOSAVE_DELAY_MS, retryDelay, sameForm, toForm, updateOps, type Form, type Level, type PendingEdit } from "./model";

export type SaveState = "saved" | "dirty" | "saving" | "retrying" | "conflict" | "error";
type Base = { level: Level; version: number; form: Form };
type Batch = { ops: ProjectOperation[]; sent: Map<string, PendingEdit>; key: string };

/**
 * Project workspace state. Inputs edit local text forms; a single-flight queue persists the changed nodes after a short
 * pause (or immediately on Ctrl+S, room switch and structural actions) in ONE atomic request with per-node versions.
 * A transport failure resends the identical batch with the identical idempotency key (2 s, 4 s … 30 s, and when the
 * browser comes back online), so a retried save is applied once and nothing typed is lost. Conflicts and validation
 * errors stop automatic saving until the employee decides. Nothing is written to browser storage.
 */
export function useProjectWorkspace(api: B2bApi, id: string, initialRoom: string | null, onDirty: (dirty: boolean) => void) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [roomId, setRoomId] = useState<string | null>(initialRoom);
  const [forms, setForms] = useState<Record<string, Form>>({});
  const [bases, setBases] = useState<Record<string, Base>>({});
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<unknown>(null), [loadError, setLoadError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [commercial, setCommercial] = useState<Commercial | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const formsRef = useRef(forms), basesRef = useRef(bases), roomRef = useRef(roomId);
  useLayoutEffect(() => { roomRef.current = roomId; });
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const intent = useRef(new Intent()), failed = useRef<Batch | null>(null), attempts = useRef(0), retryTimer = useRef<number | undefined>(undefined);
  const mounted = useRef(true), blocked = useRef(false), flushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearTimeout(retryTimer.current); }; }, []);

  const pending = useMemo(() => {
    const out = new Map<string, PendingEdit>();
    for (const [nodeId, base] of Object.entries(bases)) {
      const form = forms[nodeId];
      if (form && !sameForm(form, base.form)) out.set(nodeId, { level: base.level, version: base.version, form });
    }
    return out;
  }, [forms, bases]);
  const dirty = pending.size > 0;
  useEffect(() => { onDirty(dirty || state === "saving" || state === "retrying"); }, [dirty, state, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  /** Registers server values as the new base; a node with unsaved local edits keeps its text (and its older base version). */
  const accept = useCallback((nodes: { level: Level; id: string; version: number; fields: Record<string, unknown> }[], reset = false) => {
    const bases = { ...basesRef.current }, forms = { ...formsRef.current };
    for (const n of nodes) {
      const local = forms[n.id], base = bases[n.id];
      if (!reset && local && base && !sameForm(local, base.form)) continue;
      bases[n.id] = { level: n.level, version: n.version, form: toForm(n.level, n.fields) };
      forms[n.id] = toForm(n.level, n.fields);
    }
    basesRef.current = bases; formsRef.current = forms;
    setBases(bases); setForms(forms);
  }, []);

  const loadDetail = useCallback(async () => {
    const value = await api.getProject(id);
    if (!mounted.current) return value;
    setDetail(value);
    accept(value.zones.map(z => ({ level: "zone" as const, id: z.id, version: z.version, fields: z })));
    return value;
  }, [api, id, accept]);
  const loadRoom = useCallback(async (target: string | null, reset = false) => {
    if (!target) return;
    const value = await api.getProjectRoom(id, target);
    if (!mounted.current || roomRef.current !== target) return;
    setRoom(value);
    accept([{ level: "room", id: value.room.id, version: value.room.version, fields: value.room },
      ...value.room.openings.flatMap(o => [{ level: "opening" as const, id: o.id, version: o.version, fields: o },
        ...o.treatments.map(t => ({ level: "treatment" as const, id: t.id, version: t.version, fields: t }))])], reset);
  }, [api, id, accept]);
  const loadCommercial = useCallback(async () => {
    try { const value = await api.getProjectCommercial(id); if (mounted.current) setCommercial(value); } catch { /* the summary is optional */ }
  }, [api, id]);

  useEffect(() => {
    let active = true;
    loadDetail().then(value => {
      if (!active) return;
      const first = roomRef.current ?? value.zones.flatMap(z => z.rooms)[0]?.id ?? null;
      setRoomId(first);
    }, e => { if (active) setLoadError(e); });
    api.getProjectCommercial(id).then(value => { if (active) setCommercial(value); }, () => { /* the summary is optional */ });
    return () => { active = false; };
  }, [api, id, loadDetail]);
  useEffect(() => {
    if (!roomId) return;
    loadRoom(roomId).catch(e => { if (mounted.current) setError(e); });
  }, [roomId, loadRoom]);

  /** Sends one batch; resolves true when the server applied it. */
  const send = useCallback(async (batch: Batch): Promise<boolean> => {
    setState("saving");
    try {
      const result = await api.changeProject(id, batch.ops, { idempotencyKey: batch.key });
      failed.current = null; attempts.current = 0; intent.current.done();
      if (!mounted.current) return true;
      // The ref is advanced synchronously: a queued flush that runs right after this one must see the new versions.
      const next = { ...basesRef.current };
      for (const [nodeId, edit] of batch.sent) if (result.versions[nodeId] !== undefined) next[nodeId] = { level: edit.level, version: result.versions[nodeId], form: edit.form };
      basesRef.current = next;
      setBases(next);
      setDetail(old => old && { ...old, project: { ...old.project, revision: result.revision } });
      setFieldErrors({}); setError(null); setSavedAt(Date.now());
      setState("saved");
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      if (e instanceof ApiError && (e.code === "NETWORK_UNAVAILABLE" || e.status >= 500)) {
        failed.current = batch; attempts.current++;
        setState("retrying"); setError(e);
        window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => { void flushRef.current(); }, retryDelay(attempts.current));
        return false;
      }
      failed.current = null; attempts.current = 0; intent.current.done();
      setError(e);
      if (e instanceof ApiError && e.code === "PROJECT_CHANGED") { setState("conflict"); blocked.current = true; }
      else {
        setState("error"); blocked.current = true;
        if (e instanceof ApiError) {
          const index = (e.details as { operation?: unknown } | undefined)?.operation;
          const errors: Record<string, string> = {};
          for (const [key, reason] of Object.entries(e.fields)) {
            const m = /^operations\.(\d+)\.(?:fields\.)?(.+)$/.exec(key);
            const op = m ? batch.ops[Number(m[1])] : typeof index === "number" ? batch.ops[index] : undefined;
            if (op && "id" in op && m) errors[`${op.id}.${m[2]}`] = reason;
          }
          setFieldErrors(errors);
          if (e.code === "PROJECT_NOT_EDITABLE") void loadDetail();
        }
      }
      return false;
    }
  }, [api, id, loadDetail]);

  /**
   * Persists pending edits plus optional structural operations, in order, through one queue. A failed transport batch
   * is always resent unchanged before anything new is sent.
   */
  const flush = useCallback((extra: ProjectOperation[] = []): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      window.clearTimeout(retryTimer.current);
      if (failed.current) {
        const retried = failed.current;
        const ok = await send(retried);
        if (!ok) return false;
        if (retried.ops.some(op => !op.op.endsWith(".update"))) { await loadDetail(); await loadRoom(roomRef.current); }
      }
      const sent = new Map<string, PendingEdit>();
      for (const [nodeId, base] of Object.entries(basesRef.current)) {
        const form = formsRef.current[nodeId];
        if (form && !sameForm(form, base.form)) sent.set(nodeId, { level: base.level, version: base.version, form });
      }
      const ops = [...updateOps(sent), ...extra];
      if (ops.length === 0) { setState(s => s === "dirty" ? "saved" : s); return true; }
      const key = intent.current.keyFor(ops);
      const ok = await send({ ops, sent, key });
      if (ok && extra.length > 0) {
        await loadDetail();
        await loadRoom(roomRef.current);
      }
      // Server-calculated line totals and versions follow every save; unsaved local text is never overwritten.
      if (ok && extra.length === 0) void loadRoom(roomRef.current).catch(() => { /* the next save or navigation reloads */ });
      if (ok) void loadCommercial();
      return ok;
    };
    chain.current = chain.current.then(run, run);
    return chain.current;
  }, [send, loadDetail, loadRoom, loadCommercial]);

  useEffect(() => { flushRef.current = flush; }, [flush]);
  // Debounced automatic save; stopped by an unresolved conflict or validation error until the next edit.
  useEffect(() => {
    if (!dirty || blocked.current || state === "saving" || state === "retrying") return;
    const timer = window.setTimeout(() => { void flush(); }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [forms, dirty, state, flush]);
  useEffect(() => {
    const online = () => { if (failed.current) void flush(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [flush]);

  const edit = useCallback((nodeId: string, field: string, value: string) => {
    blocked.current = false;
    const forms = { ...formsRef.current, [nodeId]: { ...formsRef.current[nodeId], [field]: value } };
    formsRef.current = forms;
    setForms(forms);
    setFieldErrors(old => { if (!old[`${nodeId}.${field}`]) return old; const next = { ...old }; delete next[`${nodeId}.${field}`]; return next; });
    setState(s => s === "error" ? "dirty" : s);
  }, []);
  const selectRoom = useCallback(async (target: string) => {
    if (target === roomRef.current) return;
    void flush();
    setRoomId(target);
  }, [flush]);
  /** Conflict resolution: reload the current server state; keepMine reapplies local text on top of the new versions. */
  const resolveConflict = useCallback(async (keepMine: boolean) => {
    const local = formsRef.current;
    blocked.current = false;
    await loadDetail();
    await loadRoom(roomRef.current, true);
    if (keepMine) {
      const forms = { ...formsRef.current, ...Object.fromEntries(Object.entries(local).filter(([nodeId]) => formsRef.current[nodeId] !== undefined)) };
      formsRef.current = forms; setForms(forms);
    }
    setError(null); setFieldErrors({}); setState("dirty");
  }, [loadDetail, loadRoom]);
  const refresh = useCallback(async () => { await loadDetail(); await loadRoom(roomRef.current); void loadCommercial(); }, [loadDetail, loadRoom, loadCommercial]);

  return { detail, room: room && room.room.id === roomId ? room : null, roomId, forms, bases, pending, dirty, state, error, loadError, fieldErrors, commercial, savedAt,
    edit, flush, selectRoom, resolveConflict, refresh, setDetail, version: (nodeId: string) => bases[nodeId]?.version ?? 0 };
}
export type Workspace = ReturnType<typeof useProjectWorkspace>;
