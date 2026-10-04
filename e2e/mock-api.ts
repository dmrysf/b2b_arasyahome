import type { Page, Route } from "@playwright/test";

export const API = "https://api.arasyahome.ro";

export type MockOptions = { applications?: string[]; mustChangePassword?: boolean; loggedIn?: boolean };

/**
 * An in-memory double of the Central IAM endpoints B2B uses (Operations API 2.7.0 shapes). It answers through
 * page.route, so the smoke suite needs no PHP, database or network, and records every request for assertions.
 */
export async function mockApi(page: Page, options: MockOptions = {}) {
  const state = {
    loggedIn: options.loggedIn ?? false,
    mustChangePassword: options.mustChangePassword ?? false,
    applications: options.applications ?? ["b2b"],
    /** Simulates an administrator removing B2B access in Central IAM. */
    accessRemoved: false,
    authorizationVersion: 4,
    requests: [] as string[],
    headers: [] as Array<Record<string, string>>,
  };
  const employee = () => ({
    employeeUuid: "11111111-1111-4111-8111-111111111111", employeeCode: null, displayName: "Elena Vânzări", username: "elena.vanzari", department: "Vânzări", departmentKey: "vanzari",
    role: "employee", status: "active", permissions: state.applications.includes("b2b") ? ["b2b.access", "profile.view_self"] : ["profile.view_self"], allowedStageIds: [],
    applications: state.applications, roles: [], positionTitle: null, isRoot: false, mustChangePassword: state.mustChangePassword, authorizationVersion: state.authorizationVersion, locale: "ro",
  });
  const session = () => ({ employee: employee(), expiresAt: "2026-10-05T06:00:00+00:00", csrfToken: "csrf-smoke" });
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const fail = (route: Route, code: string, status: number) => json(route, { error: { code, message: "English server text", requestId: "r" } }, status);

  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    state.requests.push(`${method} ${path}`);
    state.headers.push(await request.allHeaders());
    const body = request.postData() ? JSON.parse(request.postData() as string) as Record<string, string> : {};
    if (method === "POST" && path === "/auth/login") {
      if (body.password !== "parola-corecta") return fail(route, "INVALID_CREDENTIALS", 401);
      state.loggedIn = true;
      return json(route, session());
    }
    if (method === "GET" && path === "/auth/session") return state.loggedIn ? json(route, session()) : fail(route, "NO_SESSION", 401);
    if (!state.loggedIn) return fail(route, "SESSION_EXPIRED", 401);
    if (method === "POST" && path === "/auth/logout") { state.loggedIn = false; return json(route, { ok: true }); }
    if (method === "POST" && path === "/auth/password") { state.mustChangePassword = false; return json(route, session()); }
    if (method === "GET" && path === "/b2b/access") {
      if (state.mustChangePassword) return fail(route, "PASSWORD_CHANGE_REQUIRED", 403);
      if (state.accessRemoved || !state.applications.includes("b2b")) return fail(route, "APPLICATION_ACCESS_DENIED", 403);
      return json(route, { application: "b2b", employee: { displayName: "Elena Vânzări", username: "elena.vanzari", isRoot: false }, authorizationVersion: state.authorizationVersion });
    }
    return fail(route, "NOT_FOUND", 404);
  });

  return {
    state,
    removeAccess() { state.accessRemoved = true; state.applications = state.applications.filter((key) => key !== "b2b"); state.authorizationVersion += 1; },
  };
}
