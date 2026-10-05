import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, createApi, SESSION_CODES, type B2bApi } from "./api/client";
import type { Session } from "./api/types";
import { B2B_APPLICATION, resolveSession, restoreSession, type AppState } from "./auth/session";
import { BrandMark } from "./components/ui";
import { useI18n } from "./i18n/context";
import { Shell } from "./layout/Shell";
import { ChangePasswordPage, LoginPage, NoAccessPage } from "./pages/AuthPages";
import { HomePage, NotFoundPage } from "./pages/HomePage";
import { CompaniesPage } from "./companies/CompaniesPage";
import { CompanyCreatePage } from "./companies/CompanyCreatePage";
import { CompanyDetailPage } from "./companies/CompanyDetailPage";
import { companiesRoute, companyPath } from "./companies/shared";
import { ordersRoute } from "./orders/model";
import { OrdersPage } from "./orders/OrdersPage";
import { OrderPage } from "./orders/OrderPage";

/** The authorization re-check interval while B2B is open; authorization is never cached beyond it. */
export const ACCESS_RECHECK_MS = 60_000;

function usePathname(mayLeave: () => boolean) {
  const [pathname, setPathname] = useState(() => (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search));
  const current = useRef(pathname);
  useEffect(() => {
    const update = () => {
      if (!mayLeave()) { window.history.pushState(null, "", current.current); return; }
      current.current = window.location.pathname + window.location.search;
      setPathname(current.current);
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [mayLeave]);
  const navigate = useCallback((path: string) => {
    if (path === current.current || !mayLeave()) return;
    window.history.pushState(null, "", path);
    current.current = path;
    setPathname(path);
  }, [mayLeave]);
  return { pathname, navigate };
}

export function App({ apiBaseUrl, api: injected }: { apiBaseUrl: string; api?: B2bApi }) {
  const api = useMemo(() => injected ?? createApi(apiBaseUrl), [apiBaseUrl, injected]);
  const { t, problem } = useI18n();
  const dirty = useRef(false);
  const onDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const mayLeave = useCallback(() => !dirty.current || window.confirm(t.orders.unsaved), [t.orders.unsaved]);
  const { pathname, navigate } = usePathname(mayLeave);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, []);
  const [state, setState] = useState<AppState>({ kind: "loading" });
  // A one-shot success message carried to the next page (for example "company created").
  const [flash, setFlash] = useState<{ path: string; message: string } | null>(null);

  const restore = useCallback((notice?: ApiError) => { void restoreSession(api, notice).then(setState); }, [api]);
  const accept = useCallback(async (session: Promise<Session>) => { setState(await resolveSession(api, await session)); }, [api]);

  useEffect(() => { restore(); }, [restore]);
  // A protected request that reports an expired session or changed access re-reads the central session.
  useEffect(() => api.onSessionProblem((error) => {
    if (SESSION_CODES.has(error.code)) setState({ kind: "anonymous", notice: error });
    else restore();
  }), [api, restore]);

  // Another administrator can change authorization at any time. While B2B is open, re-check the server gate when
  // the tab becomes visible and once a minute; a removed grant, deactivation or new password requirement closes B2B.
  const ready = state.kind === "ready";
  useEffect(() => {
    if (!ready) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      api.getSession().then((session) => {
        if (!session || session.employee.mustChangePassword || !session.employee.applications.includes(B2B_APPLICATION)) {
          void resolveSession(api, session, session ? undefined : new ApiError("SESSION_EXPIRED", 401)).then(setState, () => restore());
          return;
        }
        api.access().then(access => setState(previous => previous.kind === "ready" ? { ...previous, access } : previous))
          .catch(() => { /* the session-problem listener re-reads the session */ });
      }, () => { /* transport problems surface on the next real request */ });
    };
    const timer = window.setInterval(check, ACCESS_RECHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [api, ready, restore]);

  const logout = useCallback(async () => {
    if (!mayLeave()) return;
    dirty.current = false;
    try { await api.logout(); } catch { /* the session is gone either way */ }
    setState({ kind: "anonymous" });
    navigate("/");
  }, [api, navigate, mayLeave]);

  if (state.kind === "loading") return <div className="boot" role="status"><BrandMark /><p>{t.app.checkingSession}</p></div>;
  if (state.kind === "unavailable") return <div className="boot" role="alert"><BrandMark /><p>{problem(state.problem)}</p><button type="button" className="button button-secondary" onClick={() => { setState({ kind: "loading" }); restore(); }}>{t.common.retry}</button></div>;
  if (state.kind === "anonymous") return <LoginPage notice={state.notice} onLogin={(username, password) => accept(api.login(username, password))} />;
  if (state.kind === "password") return <ChangePasswordPage displayName={state.session.employee.displayName} onLogout={() => { void logout(); }} onChange={(current, next) => accept(api.changePassword(current, next))} />;
  if (state.kind === "no-access") return <NoAccessPage displayName={state.session.employee.displayName} onLogout={() => { void logout(); }} />;

  const permissions = state.access.permissions;
  const route = companiesRoute(pathname);
  const orderRoute = ordersRoute(pathname);
  const orderCaps = {
    canView: permissions.includes("b2b.orders.view"), canCreate: permissions.includes("b2b.orders.create"),
    canUpdate: permissions.includes("b2b.orders.update"), canFinalize: permissions.includes("b2b.orders.manage_status"),
    canCancel: permissions.includes("b2b.orders.manage_status"),
  };
  const queryCompany = new URLSearchParams(pathname.split("?")[1]).get("companyId") ?? undefined;
  const selectedCompany = queryCompany && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(queryCompany) ? queryCompany : undefined;
  const canView = permissions.includes("b2b.companies.view");
  const canCreate = permissions.includes("b2b.companies.create");
  const go = (path: string) => {
    if (flash && flash.path !== path) setFlash(null);
    navigate(path);
  };
  let page;
  if (pathname === "/") page = <HomePage access={state.access} session={state.session} navigate={go} />;
  else if (orderRoute?.kind === "list") page = <OrdersPage api={api} canView={orderCaps.canView} canCreate={orderCaps.canCreate && canView} navigate={go} companyId={selectedCompany} />;
  else if (orderRoute?.kind === "create") page = <OrderPage key="new-order" api={api} capabilities={orderCaps} canCompanyView={canView} companyId={selectedCompany} navigate={go} onDirty={onDirty} />;
  else if (orderRoute?.kind === "detail") page = orderCaps.canView
    ? <OrderPage key={orderRoute.id} api={api} id={orderRoute.id} capabilities={orderCaps} canCompanyView={canView} navigate={go} onDirty={onDirty} />
    : <OrdersPage api={api} canView={false} canCreate={orderCaps.canCreate && canView} navigate={go} />;
  else if (route?.kind === "create" && canCreate) {
    page = <CompanyCreatePage api={api} canView={canView} navigate={go} onCreated={(id) => { setFlash({ path: companyPath(id), message: t.companies.success.created }); navigate(companyPath(id)); }} />;
  } else if (route?.kind === "detail" && canView) {
    page = <CompanyDetailPage key={route.id} api={api} id={route.id} navigate={go} flash={flash?.path === pathname ? flash.message : null} orderCapabilities={orderCaps} />;
  } else if (route) {
    // The list explains what is missing when the identity may not view companies.
    page = <CompaniesPage api={api} canView={canView} canCreate={canCreate} navigate={go} />;
  } else page = <NotFoundPage onHome={() => go("/")} />;
  return (
    <Shell access={state.access} pathname={pathname} navigate={go} onLogout={() => { void logout(); }}>
      {page}
    </Shell>
  );
}
