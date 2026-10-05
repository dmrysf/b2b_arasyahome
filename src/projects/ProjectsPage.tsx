import { useEffect, useState } from "react";
import type { B2bApi } from "../api/client";
import type { ProjectList, ProjectStatus } from "../api/projects";
import { useI18n } from "../i18n/context";
import { PROJECTS_PATH, projectPath } from "./model";

type StatusFilter = "open" | ProjectStatus | "all";

export function ProjectsPage({ api, canView, canCreate, navigate }: { api: B2bApi; canView: boolean; canCreate: boolean; navigate: (path: string) => void }) {
  const { t, problem, dateTime } = useI18n(), p = t.projects;
  const [search, setSearch] = useState(""), [status, setStatus] = useState<StatusFilter>("open");
  const [page, setPage] = useState<{ key: string; value: ProjectList } | null>(null);
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const key = JSON.stringify({ search, status });
  useEffect(() => {
    if (!canView) return;
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true);
      api.listProjects({ search, status }).then(value => { if (active) { setPage({ key, value }); setError(null); } }, e => { if (active) setError(e); })
        .finally(() => { if (active) setBusy(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [api, canView, key, search, status]);
  const data = page?.key === key ? page.value : null;
  const more = async () => {
    if (!data?.nextCursor) return;
    try {
      const next = await api.listProjects({ search, status, cursor: data.nextCursor });
      setPage(old => old && old.key === key ? { key, value: { ...next, items: [...old.value.items, ...next.items] } } : old);
    } catch (e) { setError(e); }
  };
  return <section className="page page-wide">
    <header className="page-header page-header-actions">
      <div><p className="eyebrow">{p.workspace}</p><h1>{p.title}</h1><p>{p.subtitle}</p></div>
      {canCreate && <a className="button" href={`${PROJECTS_PATH}/nou`} onClick={e => { e.preventDefault(); navigate(`${PROJECTS_PATH}/nou`); }}>{p.newProject}</a>}
    </header>
    {!canView ? <section className="card"><h2>{p.noView}</h2></section> : <>
      <div className="card project-filters">
        <label>{p.search}<input value={search} maxLength={100} placeholder={p.searchPlaceholder} onChange={e => setSearch(e.target.value)} /></label>
        <label>{p.statusLabel}<select value={status} onChange={e => setStatus(e.target.value as StatusFilter)}>
          {(["open", "draft", "active", "archived", "all"] as const).map(s => <option key={s} value={s}>{p.statuses[s]}</option>)}</select></label>
      </div>
      {error !== null && <p role="alert" className="notice notice-error">{problem(error)}</p>}
      {busy && !data && <p role="status">{p.loading}</p>}
      {data && <div className="project-list">
        {data.items.map(item => <article className="card project-list-item" key={item.id}>
          <div>
            <a className="order-code mono" href={projectPath(item.id)} onClick={e => { e.preventDefault(); navigate(projectPath(item.id)); }}>{item.code}</a>
            <h3>{item.name}</h3>
            <p className="muted">{item.company.legalName} · {item.company.code}</p>
          </div>
          <div className="project-list-meta">
            <span className={`badge status-${item.status}`}>{p.statuses[item.status]}</span>
            <span className="badge">{p.types[item.propertyType]}</span>
            <p>{p.rooms(item.roomCount)} · {p.openings(item.openingCount)}</p>
            <p className="muted">{p.updated} {dateTime(item.updatedAt)} · {item.updatedBy.displayName}</p>
          </div>
        </article>)}
        {data.items.length === 0 && <div className="card empty-lines">{p.empty}</div>}
        {data.nextCursor && <button type="button" className="button button-secondary" onClick={() => void more()}>{p.more}</button>}
      </div>}
    </>}
  </section>;
}
