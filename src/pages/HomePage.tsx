import type { B2bAccess, Session } from "../api/types";
import { useI18n } from "../i18n/context";
import { COMPANIES_PATH } from "../companies/shared";
import { PLANNED_MODULES } from "../layout/modules";
import { ACCOUNTS_PATH } from "../accounts/model";
import { PROJECTS_PATH } from "../projects/model";

/** The landing page: the identity B2B received from Central IAM and the modules. No business data. */
export function HomePage({ access, session, navigate }: { access: B2bAccess; session: Session; navigate: (path: string) => void }) {
  const { t, dateTime } = useI18n();
  const h = t.home;
  const has = (permission: B2bAccess["permissions"][number]) => access.permissions.includes(permission);
  const canQuick = has("b2b.orders.create") && has("b2b.companies.view"), canProject = has("b2b.projects.create") && has("b2b.companies.view");
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">{t.brand.name}</p>
        <h1>{h.greeting(access.employee.displayName)}</h1>
        <p>{t.brand.product}</p>
      </header>
      {(canQuick || canProject) && <nav className="entry-grid" aria-label={t.shell.navigation}>
        {canQuick && <a className="card entry-card" href="/comenzi/noua" onClick={event => { event.preventDefault(); navigate("/comenzi/noua"); }}>
          <span className="entry-icon" aria-hidden="true">≡</span><strong>{t.projects.quickOrder}</strong><span>{t.projects.quickOrderHint}</span></a>}
        {canProject && <a className="card entry-card" href={`${PROJECTS_PATH}/nou`} onClick={event => { event.preventDefault(); navigate(`${PROJECTS_PATH}/nou`); }}>
          <span className="entry-icon" aria-hidden="true">⌂</span><strong>{t.projects.newProject}</strong><span>{t.projects.newProjectHint}</span></a>}
      </nav>}
      <section className="card hero-card" aria-labelledby="foundation-title">
        <h2 id="foundation-title">{h.foundationTitle}</h2>
        <p>{h.foundationBody}</p>
      </section>
      <div className="grid-2">
        <section className="card" aria-labelledby="account-title">
          <h2 id="account-title">{h.accountTitle}</h2>
          <dl className="facts">
            <div><dt>{h.accountName}</dt><dd>{access.employee.displayName}</dd></div>
            <div><dt>{h.accountUsername}</dt><dd className="mono">{access.employee.username}</dd></div>
            <div><dt>{h.accountAccess}</dt><dd><span className="badge badge-success">{h.accessActive}</span>{access.employee.isRoot && <span className="badge badge-root">{h.rootAccount}</span>}</dd></div>
            <div><dt>{h.sessionUntil}</dt><dd>{dateTime(session.expiresAt)}</dd></div>
          </dl>
        </section>
        <section className="card" aria-labelledby="modules-title">
          <h2 id="modules-title">{h.modulesTitle}</h2>
          <p className="muted">{h.modulesBody}</p>
          <ul className="module-list">
            {access.permissions.some(p => p.startsWith("b2b.companies.")) && (
              <li>
                <a className="link" href={COMPANIES_PATH} onClick={(event) => { event.preventDefault(); navigate(COMPANIES_PATH); }}>{t.shell.modules.companies}</a>
                <span className="badge badge-success">{h.available}</span>
              </li>
            )}
            {access.permissions.some(p => p.startsWith("b2b.orders.")) && <li><a className="link" href="/comenzi" onClick={event => { event.preventDefault(); navigate("/comenzi"); }}>{t.shell.modules.orders}</a><span className="badge badge-success">{h.available}</span></li>}
            {access.permissions.includes("b2b.projects.view") && <li><a className="link" href={PROJECTS_PATH} onClick={event => { event.preventDefault(); navigate(PROJECTS_PATH); }}>{t.shell.modules.projects}</a><span className="badge badge-success">{h.available}</span></li>}
            {access.permissions.includes("b2b.accounts.view") && <li><a className="link" href={ACCOUNTS_PATH} onClick={event => { event.preventDefault(); navigate(ACCOUNTS_PATH); }}>{t.shell.modules.accounts}</a><span className="badge badge-success">{h.available}</span></li>}
            {PLANNED_MODULES.map((key) => <li key={key}><span>{t.shell.modules[key]}</span><span className="soon">{t.shell.planned}</span></li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function NotFoundPage({ onHome }: { onHome: () => void }) {
  const { t } = useI18n();
  return (
    <div className="page">
      <header className="page-header"><h1>{t.app.notFoundTitle}</h1><p>{t.app.notFoundHint}</p></header>
      <div><button type="button" className="button button-secondary" onClick={onHome}>{t.app.backHome}</button></div>
    </div>
  );
}
