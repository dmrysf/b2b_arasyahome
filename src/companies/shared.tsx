import type { RecordStatus } from "../api/companies";
import { useI18n } from "../i18n/context";

/** B2B routes for the Companies module (Romanian paths, like the rest of the application). */
export const COMPANIES_PATH = "/companii";
export const CREATE_PATH = "/companii/noua";
export const companyPath = (id: string) => `${COMPANIES_PATH}/${encodeURIComponent(id)}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type CompaniesRoute = { kind: "list" } | { kind: "create" } | { kind: "detail"; id: string } | null;

export function companiesRoute(pathname: string): CompaniesRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === COMPANIES_PATH) return { kind: "list" };
  if (path === CREATE_PATH) return { kind: "create" };
  if (path.startsWith(`${COMPANIES_PATH}/`)) {
    const id = decodeURIComponent(path.slice(COMPANIES_PATH.length + 1));
    return UUID.test(id) ? { kind: "detail", id } : null;
  }
  return null;
}

export function StatusBadge({ status }: { status: RecordStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${status === "active" ? "badge-success" : "badge-muted"}`}>{t.companies.status[status]}</span>;
}

export function PrimaryBadge() {
  const { t } = useI18n();
  return <span className="badge badge-accent">{t.companies.primary}</span>;
}

/** A short-lived confirmation of a completed action, announced politely. */
export function SuccessNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="notice notice-success" role="status">{message}</p>;
}
