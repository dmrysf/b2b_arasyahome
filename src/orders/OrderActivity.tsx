import { useEffect, useState } from "react";
import type { B2bApi } from "../api/client";
import type { ActivityPage } from "../api/companies";
import { useI18n } from "../i18n/context";
export function OrderActivity({ api, id, version }: { api: B2bApi; id: string; version: number }) {
  const { t, problem, dateTime } = useI18n(), o = t.orders;
  const [page, setPage] = useState<ActivityPage | null>(null), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api.orderActivity(id).then(value => { if (active) { setPage(value); setError(null); } }, e => { if (active) setError(e); });
    return () => { active = false; };
  }, [api, id, version]);
  const more = async () => {
    if (busy) return;
    setBusy(true);
    try { const next = await api.orderActivity(id, page?.nextCursor); setPage(old => ({ ...next, items: [...(old?.items ?? []), ...next.items] })); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  return <section className="card"><h2>{o.activity}</h2>{error !== null && <p role="alert">{problem(error)}</p>}
    <ol className="timeline">{page?.items.map(a => <li key={a.id}>
      <strong>{Object.hasOwn(o, a.action) ? o[a.action as keyof typeof o] : o.unknownActivity}</strong>
      <p>{a.actor.displayName} · {dateTime(a.occurredAt)}</p>
      <p className="muted">{o.changedFields}: {a.changedFields.map(f => Object.hasOwn(o, f) ? o[f as keyof typeof o] : o.details).join(", ")}</p>
    </li>)}</ol>{page?.nextCursor && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void more()}>{o.more}</button>}
  </section>;
}
