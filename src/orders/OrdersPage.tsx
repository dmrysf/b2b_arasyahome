import { useEffect, useState } from "react";
import type { B2bApi } from "../api/client";
import type { OrderList, OrderQuery } from "../api/orders";
import { useI18n } from "../i18n/context";
import { orderPath } from "./model";

export function OrdersPage({ api, canView, canCreate, navigate, companyId }: {
  api: B2bApi; canView: boolean; canCreate: boolean; navigate: (path: string) => void; companyId?: string;
}) {
  const { t, problem, dateTime } = useI18n(), o = t.orders;
  const [query, setQuery] = useState<OrderQuery>({ search: "", status: "all", currency: "all", from: "", to: "" });
  const [page, setPage] = useState<{ key: string; value: OrderList } | null>(null);
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [moreBusy, setMoreBusy] = useState(false);
  const key = JSON.stringify({ ...query, companyId, limit: 25 });
  useEffect(() => {
    if (!canView) return;
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true);
      api.listOrders(JSON.parse(key) as OrderQuery).then(value => { if (active) { setPage({ key, value }); setError(null); } }, e => { if (active) setError(e); })
        .finally(() => { if (active) setBusy(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [api, canView, key]);
  const data = page?.key === key ? page.value : null;
  const more = async () => {
    if (!data?.nextCursor || moreBusy) return;
    setMoreBusy(true);
    try {
      const next = await api.listOrders({ ...JSON.parse(key) as OrderQuery, cursor: data.nextCursor });
      setPage(old => old?.key === key ? { key, value: { ...next, items: [...old.value.items, ...next.items] } } : old);
    } catch (e) { setError(e); } finally { setMoreBusy(false); }
  };
  return <section className="page page-wide order-list-page">
    <header className="page-header order-section-title"><div>{companyId ? <h2>{o.history}</h2> : <><p className="eyebrow">{o.workstation}</p><h1>{o.title}</h1></>}</div>
      {canCreate && <a className="button" href={`/comenzi/noua${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`}
        onClick={event => { event.preventDefault(); navigate(event.currentTarget.getAttribute("href")!); }}>{o.newOrder}</a>}
    </header>
    {!canView ? <section className="card"><h2>{o.noView}</h2></section> : <>
      <div className="card order-list-filters">
        <label>{o.search}<input maxLength={100} value={query.search} onChange={e => setQuery(q => ({ ...q, search: e.target.value }))} /></label>
        <label>{o.statusLabel}<select value={query.status} onChange={e => setQuery(q => ({ ...q, status: e.target.value as OrderQuery["status"] }))}>
          {(["all", "draft", "finalized", "cancelled"] as const).map(s => <option key={s} value={s}>{o[s]}</option>)}</select></label>
        <label>{o.currency}<select value={query.currency} onChange={e => setQuery(q => ({ ...q, currency: e.target.value as OrderQuery["currency"] }))}>
          <option value="all">{o.all}</option><option value="RON">RON</option><option value="EUR">EUR</option></select></label>
        <label>{o.from}<input type="date" value={query.from} onChange={e => setQuery(q => ({ ...q, from: e.target.value }))} /></label>
        <label>{o.to}<input type="date" value={query.to} min={query.from} onChange={e => setQuery(q => ({ ...q, to: e.target.value }))} /></label>
      </div>
      {error !== null && <p role="alert" className="notice">{problem(error)}</p>}
      {busy && <p role="status">{o.loading}</p>}
      {data && <div className="order-list">{data.items.map(i => <article className="card order-list-item" key={i.id}>
        <div><a className="order-code mono" href={orderPath(i.id)} onClick={e => { e.preventDefault(); navigate(orderPath(i.id)); }}>{i.code}</a>
          <h3>{i.companyName}</h3><p className="muted">{dateTime(i.createdAt)} · {i.createdBy.displayName}</p>
          {i.customerReference && <p>{i.customerReference}</p>}</div>
        <div><span className={`badge status-${i.status}`}>{o[i.status]}</span><dl className="order-list-totals">
          {(["net", "vat", "gross"] as const).map(k => <div key={k}><dt>{o[k]}</dt><dd>{i.totals?.[k] ?? "—"} {i.currencyCode}</dd></div>)}
        </dl></div>
      </article>)}
        {data.items.length === 0 && <div className="card empty-lines">{o.empty}</div>}
        {data.nextCursor && <button type="button" className="button button-secondary" disabled={moreBusy} onClick={() => void more()}>{o.more}</button>}
      </div>}
    </>}
  </section>;
}
