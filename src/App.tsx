import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createApi, SESSION_CODES, type B2bApi } from "./api/client";
import type { Session } from "./api/types";
import { B2B_APPLICATION, resolveSession, restoreSession, type AppState } from "./auth/session";
import { BrandMark } from "./components/ui";
import { useI18n } from "./i18n/context";
import { Shell } from "./layout/Shell";
import { ChangePasswordPage, LoginPage, NoAccessPage } from "./pages/AuthPages";
import { HomePage, NotFoundPage } from "./pages/HomePage";

/** The authorization re-check interval while B2B is open; authorization is never cached beyond it. */
export const ACCESS_RECHECK_MS = 60_000;

function usePathname() {
  const [pathname, setPathname] = useState(() => (typeof window === "undefined" ? "/" : window.location.pathname));
  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const navigate = useCallback((path: string) => {
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
    setPathname(path);
  }, []);
  return { pathname, navigate };
}

export function App({ apiBaseUrl, api: injected }: { apiBaseUrl: string; api?: B2bApi }) {
  const api = useMemo(() => injected ?? createApi(apiBaseUrl), [apiBaseUrl, injected]);
  const { pathname, navigate } = usePathname();
  const { t, problem } = useI18n();
  const [state, setState] = useState<AppState>({ kind: "loading" });

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
        api.access().catch(() => { /* the session-problem listener re-reads the session */ });
      }, () => { /* transport problems surface on the next real request */ });
    };
    const timer = window.setInterval(check, ACCESS_RECHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", check); };
  }, [api, ready, restore]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* the session is gone either way */ }
    setState({ kind: "anonymous" });
    navigate("/");
  }, [api, navigate]);

  if (state.kind === "loading") return <div className="boot" role="status"><BrandMark /><p>{t.app.checkingSession}</p></div>;
  if (state.kind === "unavailable") return <div className="boot" role="alert"><BrandMark /><p>{problem(state.problem)}</p><button type="button" className="button button-secondary" onClick={() => { setState({ kind: "loading" }); restore(); }}>{t.common.retry}</button></div>;
  if (state.kind === "anonymous") return <LoginPage notice={state.notice} onLogin={(username, password) => accept(api.login(username, password))} />;
  if (state.kind === "password") return <ChangePasswordPage displayName={state.session.employee.displayName} onLogout={() => { void logout(); }} onChange={(current, next) => accept(api.changePassword(current, next))} />;
  if (state.kind === "no-access") return <NoAccessPage displayName={state.session.employee.displayName} onLogout={() => { void logout(); }} />;

  return (
    <Shell access={state.access} pathname={pathname} navigate={navigate} onLogout={() => { void logout(); }}>
      {pathname === "/" ? <HomePage access={state.access} session={state.session} /> : <NotFoundPage onHome={() => navigate("/")} />}
    </Shell>
  );
}
