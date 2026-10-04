import { useEffect, useId, useRef, useState } from "react";
import type { B2bApi } from "../api/client";
import type { CompanyListItem, StatusFilter } from "../api/companies";
import { ErrorText } from "../components/ui";
import { toProblem, type Problem } from "../i18n";
import { useI18n } from "../i18n/context";
import { countryName } from "./countries";
import { CountrySelect } from "./forms";
import { companyPath, CREATE_PATH, StatusBadge } from "./shared";

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;

type Filters = { search: string; status: StatusFilter; country: string };
type ListState = { items: CompanyListItem[]; nextCursor: string | null; loading: boolean; problem: Problem | null; loaded: boolean };

/**
 * The searchable company list. Search, filters and pagination run on the server (keyset pages of 50); the browser
 * only ever holds the pages the employee asked for.
 */
export function CompaniesPage({ api, canView, canCreate, navigate }: { api: B2bApi; canView: boolean; canCreate: boolean; navigate: (path: string) => void }) {
  const { t } = useI18n();
  const c = t.companies;
  const [filters, setFilters] = useState<Filters>({ search: "", status: "active", country: "" });
  const [query, setQuery] = useState<Filters>(filters);
  const [state, setState] = useState<ListState>({ items: [], nextCursor: null, loading: canView, problem: null, loaded: false });
  const request = useRef(0);
  const searchId = useId();
  const statusId = useId();
  const countryId = useId();

  // Typing waits briefly before searching; selects apply at once.
  useEffect(() => {
    const same = (a: Filters, b: Filters) => a.search === b.search && a.status === b.status && a.country === b.country;
    const timer = window.setTimeout(() => setQuery((previous) => (same(previous, filters) ? previous : filters)), filters.search === query.search ? 0 : SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [filters, query.search]);

  useEffect(() => {
    if (!canView) return;
    const ticket = ++request.current;
    api.listCompanies({ ...query, limit: PAGE_SIZE }).then(
      (page) => { if (ticket === request.current) setState({ items: page.items, nextCursor: page.nextCursor, loading: false, problem: null, loaded: true }); },
      (error) => { if (ticket === request.current) setState((previous) => ({ ...previous, loading: false, problem: toProblem(error) })); },
    );
  }, [api, canView, query]);

  const loadMore = () => {
    if (!state.nextCursor) return;
    const ticket = ++request.current;
    setState((previous) => ({ ...previous, loading: true, problem: null }));
    api.listCompanies({ ...query, cursor: state.nextCursor, limit: PAGE_SIZE }).then(
      (page) => { if (ticket === request.current) setState((previous) => ({ items: [...previous.items, ...page.items], nextCursor: page.nextCursor, loading: false, problem: null, loaded: true })); },
      // A failed page keeps everything already shown.
      (error) => { if (ticket === request.current) setState((previous) => ({ ...previous, loading: false, problem: toProblem(error) })); },
    );
  };

  const filtered = query.search.trim() !== "" || query.status !== "active" || query.country !== "";
  return (
    <div className="page page-wide">
      <header className="page-header page-header-actions">
        <div>
          <h1>{c.title}</h1>
          <p>{c.subtitle}</p>
        </div>
        {canCreate && <a className="button button-primary" href={CREATE_PATH} onClick={(event) => { event.preventDefault(); navigate(CREATE_PATH); }}>{c.create}</a>}
      </header>

      {!canView ? (
        <section className="card" role="status">
          <h2>{c.noViewTitle}</h2>
          <p className="muted">{canCreate ? c.createOnlyBody : c.noViewBody}</p>
        </section>
      ) : (
        <>
          <section className="card filters">
            <div className="field filter-search">
              <label htmlFor={searchId}>{c.searchLabel}</label>
              <input id={searchId} type="search" value={filters.search} placeholder={c.searchPlaceholder} maxLength={100} autoComplete="off"
                onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={statusId}>{c.statusFilter}</label>
              <select id={statusId} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as StatusFilter })}>
                {(["active", "inactive", "all"] as const).map((status) => <option key={status} value={status}>{c.statusFilters[status]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={countryId}>{c.countryFilter}</label>
              <CountrySelect id={countryId} includeAll value={filters.country} onChange={(country) => setFilters({ ...filters, country })} />
            </div>
          </section>

          {state.problem && <ErrorText error={state.problem} />}
          {!state.loaded && state.loading && <p className="muted" role="status">{c.loading}</p>}
          {state.loaded && state.items.length === 0 && !state.loading && <section className="card empty" role="status"><p>{filtered ? c.emptyFiltered : c.empty}</p></section>}
          {state.items.length > 0 && <CompanyTable items={state.items} navigate={navigate} />}
          {state.loaded && (
            <div className="list-footer">
              <span className="muted">{c.shown(state.items.length)}</span>
              {state.nextCursor && <button type="button" className="button button-secondary" disabled={state.loading} onClick={loadMore}>{state.loading ? c.loading : c.loadMore}</button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CompanyTable({ items, navigate }: { items: CompanyListItem[]; navigate: (path: string) => void }) {
  const { t, locale, dateTime } = useI18n();
  const col = t.companies.columns;
  return (
    <div className="card table-card">
      <table className="company-table">
        <thead>
          <tr>
            <th scope="col">{col.code}</th>
            <th scope="col">{col.name}</th>
            <th scope="col">{col.taxIdentifier}</th>
            <th scope="col">{col.city}</th>
            <th scope="col">{col.country}</th>
            <th scope="col">{col.primaryContact}</th>
            <th scope="col">{col.status}</th>
            <th scope="col">{col.updatedAt}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={item.status === "inactive" ? "is-inactive" : undefined}>
              <td data-label={col.code} className="mono nowrap">{item.code}</td>
              <td data-label={col.name}>
                <div className="cell-name">
                  <a href={companyPath(item.id)} onClick={(event) => { event.preventDefault(); navigate(companyPath(item.id)); }}>{item.legalName}</a>
                  {item.displayName && item.displayName !== item.legalName && <span className="muted">{item.displayName}</span>}
                </div>
              </td>
              <td data-label={col.taxIdentifier} className="mono">{item.taxIdentifier}</td>
              <td data-label={col.city}>{item.city ?? t.companies.noValue}</td>
              <td data-label={col.country} className="nowrap">{countryName(item.countryCode, locale)}</td>
              <td data-label={col.primaryContact}>{item.primaryContact?.name ?? t.companies.noValue}</td>
              <td data-label={col.status} className="nowrap"><StatusBadge status={item.status} /></td>
              <td data-label={col.updatedAt}>{dateTime(item.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
