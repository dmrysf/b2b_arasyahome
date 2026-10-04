import type { B2bAccess, Session } from "../api/types";
import { useI18n } from "../i18n/context";
import { PLANNED_MODULES } from "../layout/modules";

/** The Foundation landing page: the identity B2B received from Central IAM and the planned modules. No business data. */
export function HomePage({ access, session }: { access: B2bAccess; session: Session }) {
  const { t, dateTime } = useI18n();
  const h = t.home;
  return (
    <div className="page">
      <header className="page-header">
        <p className="eyebrow">{t.brand.name}</p>
        <h1>{h.greeting(access.employee.displayName)}</h1>
        <p>{t.brand.product}</p>
      </header>
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
