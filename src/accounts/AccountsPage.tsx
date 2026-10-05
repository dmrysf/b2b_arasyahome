import { useEffect, useState } from "react";
import type { B2bApi } from "../api/client";
import type { AccountOverview, AccountSummary, OverviewQuery } from "../api/accounts";
import { companyPath } from "../companies/shared";
import { useI18n } from "../i18n/context";
import { AccountPanel } from "./AccountPanel";
import { ACCOUNTS_PATH, accountPath, balanceKind, absolute, formatMoney } from "./model";

/** Top-level "Conturi curente": every company with its RON and EUR balance, straight from the server ledger. */
export function AccountsPage({ api, canView, navigate }: { api: B2bApi; canView: boolean; navigate: (path: string) => void }) {
  const { t, locale, problem } = useI18n();
  const a = t.accounts;
  const [query, setQuery] = useState<OverviewQuery>({ search: "", status: "all", balance: "all" });
  const [page, setPage] = useState<{ key: string; value: AccountOverview } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify({ ...query, limit: 25 });
  useEffect(() => {
    if (!canView) return;
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true);
      api.accountsOverview(JSON.parse(key) as OverviewQuery).then((value) => { if (active) { setPage({ key, value }); setError(null); } }, (e) => { if (active) setError(e); })
        .finally(() => { if (active) setBusy(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [api, canView, key]);
  const data = page?.key === key ? page.value : null;
  const more = async () => {
    if (!data?.nextCursor) return;
    setBusy(true);
    try {
      const next = await api.accountsOverview({ ...JSON.parse(key) as OverviewQuery, cursor: data.nextCursor });
      setPage((old) => (old?.key === key ? { key, value: { ...next, items: [...old.value.items, ...next.items] } } : old));
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const balance = (value: string, currency: string) => {
    const kind = balanceKind(value);
    return <span className={`account-amount balance-${kind}`}>{kind === "credit" ? `${a.credit}: ` : ""}<span className="mono">{formatMoney(absolute(value), locale, currency)}</span></span>;
  };
  return (
    <section className="page page-wide">
      <header className="page-header"><p className="eyebrow">{t.brand.name}</p><h1>{a.title}</h1><p>{a.subtitle}</p></header>
      {!canView ? <section className="card"><h2>{a.noView}</h2></section> : <>
        <div className="card account-filters">
          <div className="field"><label htmlFor="account-search">{a.search}</label>
            <input id="account-search" type="search" maxLength={100} placeholder={a.searchPlaceholder} value={query.search} onChange={(event) => setQuery({ ...query, search: event.target.value })} /></div>
          <div className="field"><label htmlFor="account-balance">{a.balanceFilter}</label>
            <select id="account-balance" value={query.balance} onChange={(event) => setQuery({ ...query, balance: event.target.value as OverviewQuery["balance"] })}>
              <option value="all">{a.balanceAll}</option><option value="open">{a.balanceOpen}</option></select></div>
          <div className="field"><label htmlFor="account-status">{a.statusFilter}</label>
            <select id="account-status" value={query.status} onChange={(event) => setQuery({ ...query, status: event.target.value as OverviewQuery["status"] })}>
              <option value="all">{a.statusAll}</option><option value="active">{a.active}</option><option value="inactive">{a.inactive}</option></select></div>
        </div>
        {error !== null && <p className="notice notice-error" role="alert">{problem(error)}</p>}
        {data && <div className="table-scroll card">
          <table className="account-table">
            <thead><tr><th>{t.orders.company}</th><th className="num">RON</th><th className="num">EUR</th><th>{a.lastMovement}</th></tr></thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.companyId}>
                  <td>
                    <a className="link" href={accountPath(item.companyId)} onClick={(event) => { event.preventDefault(); navigate(accountPath(item.companyId)); }}>{item.legalName}</a>
                    <p className="meta"><span className="mono">{item.companyCode}</span> · {a.movementCount(item.movementCount)}{item.companyStatus === "inactive" ? ` · ${a.inactive}` : ""}</p>
                  </td>
                  <td className="num">{balance(item.balances.RON, "RON")}</td>
                  <td className="num">{balance(item.balances.EUR, "EUR")}</td>
                  <td>{item.lastValueDate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.items.length === 0 && <p className="muted">{a.empty}</p>}
        </div>}
        {busy && <p className="muted" role="status">{a.loading}</p>}
        {data?.nextCursor && !busy && <div><button type="button" className="button button-secondary" onClick={() => { void more(); }}>{a.more}</button></div>}
      </>}
    </section>
  );
}

/** /conturi-curente/{companyId}: the same account panel as the company tab, with the company identity on top. */
export function CompanyAccountPage({ api, companyId, canViewCompany, navigate }: { api: B2bApi; companyId: string; canViewCompany: boolean; navigate: (path: string) => void }) {
  const { t, problem } = useI18n();
  const a = t.accounts;
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let active = true;
    api.accountSummary(companyId).then((value) => { if (active) setSummary(value); }, (e) => { if (active) setError(e); });
    return () => { active = false; };
  }, [api, companyId]);
  return (
    <div className="page page-wide">
      <header className="page-header company-header">
        <a className="back-link" href={ACCOUNTS_PATH} onClick={(event) => { event.preventDefault(); navigate(ACCOUNTS_PATH); }}>← {a.back}</a>
        {summary && <div className="company-title"><div>
          <p className="eyebrow mono">{summary.company.code}</p>
          <h1>{summary.company.legalName}</h1>
          <p>{a.tab} · {summary.company.countryCode} {summary.company.taxIdentifier}</p>
        </div>
          {canViewCompany && <a className="button button-secondary" href={companyPath(companyId)} onClick={(event) => { event.preventDefault(); navigate(companyPath(companyId)); }}>{a.openCompany}</a>}
        </div>}
      </header>
      {error !== null ? <p className="notice notice-error" role="alert">{problem(error)}</p> : <AccountPanel api={api} companyId={companyId} />}
    </div>
  );
}
