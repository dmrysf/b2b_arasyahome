import { useState, type ReactNode } from "react";
import type { B2bAccess } from "../api/types";
import { useI18n } from "../i18n/context";
import { BrandMark, LocaleSwitcher } from "../components/ui";
import { B2B_VERSION } from "../version";
import { COMPANIES_PATH } from "../companies/shared";
import { PLANNED_MODULES } from "./modules";

export function Shell({ access, pathname, navigate, onLogout, children }: { access: B2bAccess; pathname: string; navigate: (path: string) => void; onLogout: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const inCompanies = pathname === COMPANIES_PATH || pathname.startsWith(`${COMPANIES_PATH}/`);
  return (
    <div className={`shell ${open ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand"><BrandMark /><div><strong>{t.brand.name}</strong><span>{t.brand.product}</span></div></div>
        <nav aria-label={t.shell.navigation}>
          <a href="/" className={pathname === "/" ? "active" : ""} aria-current={pathname === "/" ? "page" : undefined}
            onClick={(event) => { event.preventDefault(); setOpen(false); navigate("/"); }}>{t.shell.home}</a>
          {access.permissions.length > 0 && (
            <a href={COMPANIES_PATH} className={inCompanies ? "active" : ""} aria-current={inCompanies ? "page" : undefined}
              onClick={(event) => { event.preventDefault(); setOpen(false); navigate(COMPANIES_PATH); }}>{t.shell.modules.companies}</a>
          )}
          <p className="nav-section">{t.shell.planned}</p>
          <ul className="nav-planned">
            {PLANNED_MODULES.map((key) => (
              <li key={key} title={t.shell.plannedHint}>
                <span>{t.shell.modules[key]}</span><span className="soon">{t.shell.planned}</span>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-footer">
          <div className="identity">
            <strong>{access.employee.displayName}</strong>
            <span>{access.employee.username}</span>
          </div>
          <button type="button" className="button button-ghost button-block" onClick={onLogout}>{t.common.logout}</button>
          <span className="version">{t.common.version(B2B_VERSION)}</span>
        </div>
      </aside>
      <div className="main-column">
        <div className="topbar">
          <button type="button" className="menu-toggle" aria-label={t.shell.menu} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span /><span /><span /></button>
          <strong className="topbar-title">{t.brand.title}</strong>
          <LocaleSwitcher />
        </div>
        <main className="content">{children}</main>
      </div>
      {open && <button type="button" className="nav-scrim" aria-label={t.shell.menu} onClick={() => setOpen(false)} />}
    </div>
  );
}
