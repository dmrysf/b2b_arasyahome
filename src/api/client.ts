import type { B2bAccess, Session, SessionEmployee } from "./types";

/** A typed API failure. `code` is the server error code; transport problems use NETWORK_UNAVAILABLE. */
export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number, message?: string) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

/** Codes after which the app must treat the central session as gone. */
export const SESSION_CODES = new Set(["SESSION_EXPIRED", "NO_SESSION", "AUTHENTICATION_REQUIRED", "ACCOUNT_INACTIVE"]);
/** Codes after which the app must re-read the central session because authorization changed. */
export const ACCESS_CHANGED_CODES = new Set(["APPLICATION_ACCESS_DENIED", "PASSWORD_CHANGE_REQUIRED"]);

type Fetch = typeof fetch;
type Listener = (error: ApiError) => void;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("INVALID_RESPONSE", 502);
  return value as Record<string, unknown>;
}

/** Strict mapping of the central session; anything malformed fails closed. */
export function mapSessionEmployee(value: unknown): SessionEmployee {
  const raw = asObject(value);
  const text = (field: string) => { const v = raw[field]; if (typeof v !== "string" || !v) throw new ApiError("INVALID_RESPONSE", 502); return v; };
  const applications = raw.applications;
  if (!Array.isArray(applications) || applications.some((item) => typeof item !== "string")) throw new ApiError("INVALID_RESPONSE", 502);
  if (typeof raw.isRoot !== "boolean" || typeof raw.mustChangePassword !== "boolean" || typeof raw.authorizationVersion !== "number") throw new ApiError("INVALID_RESPONSE", 502);
  return {
    employeeUuid: text("employeeUuid"),
    displayName: text("displayName"),
    username: text("username"),
    applications: applications as string[],
    isRoot: raw.isRoot,
    mustChangePassword: raw.mustChangePassword,
    authorizationVersion: raw.authorizationVersion,
  };
}

function mapSession(value: unknown): Session & { csrfToken: string } {
  const raw = asObject(value);
  if (typeof raw.expiresAt !== "string" || typeof raw.csrfToken !== "string" || !raw.csrfToken) throw new ApiError("INVALID_RESPONSE", 502);
  return { employee: mapSessionEmployee(raw.employee), expiresAt: raw.expiresAt, csrfToken: raw.csrfToken };
}

function mapAccess(value: unknown): B2bAccess {
  const raw = asObject(value);
  const employee = asObject(raw.employee);
  if (raw.application !== "b2b" || typeof raw.authorizationVersion !== "number" || typeof employee.displayName !== "string" || typeof employee.username !== "string" || typeof employee.isRoot !== "boolean") {
    throw new ApiError("INVALID_RESPONSE", 502);
  }
  return { application: "b2b", employee: { displayName: employee.displayName, username: employee.username, isRoot: employee.isRoot }, authorizationVersion: raw.authorizationVersion };
}

export type B2bApi = ReturnType<typeof createApi>;

/**
 * The only way B2B talks to the Operations API. Every request carries the API-owned HttpOnly session cookie
 * (`credentials: "include"`); the CSRF token is held in memory only and sent on mutations. Nothing is ever
 * written to browser storage.
 */
export function createApi(baseUrl: string, fetchImpl: Fetch = (...args) => fetch(...args)) {
  let csrfToken = "";
  const listeners = new Set<Listener>();

  async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const method = init.method ?? "GET";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, baseUrl).toString(), { method, headers, credentials: "include", cache: "no-store", body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    } catch {
      throw new ApiError("NETWORK_UNAVAILABLE", 0);
    }
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      const error = payload && typeof payload === "object" ? (payload as { error?: { code?: unknown } }).error : undefined;
      const code = typeof error?.code === "string" ? error.code : response.status >= 500 ? "SERVER_ERROR" : "REQUEST_FAILED";
      const failure = new ApiError(code, response.status);
      if (SESSION_CODES.has(code)) csrfToken = "";
      // The login, session and password calls report their own outcome; every other request tells the app.
      if (path !== "/auth/login" && path !== "/auth/session" && path !== "/auth/password" && (SESSION_CODES.has(code) || ACCESS_CHANGED_CODES.has(code))) {
        listeners.forEach((listener) => listener(failure));
      }
      throw failure;
    }
    if (payload === null) throw new ApiError("INVALID_RESPONSE", response.status);
    return payload as T;
  }

  const withSession = async (promise: Promise<unknown>): Promise<Session> => {
    const session = mapSession(await promise);
    csrfToken = session.csrfToken;
    return { employee: session.employee, expiresAt: session.expiresAt };
  };

  return {
    onSessionProblem(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** The current central session, or null when there is none. */
    async getSession(): Promise<Session | null> {
      try { return await withSession(request("/auth/session")); }
      catch (error) {
        if (error instanceof ApiError && (error.code === "NO_SESSION" || error.code === "SESSION_EXPIRED")) { csrfToken = ""; return null; }
        throw error;
      }
    },
    login: (username: string, password: string) => withSession(request("/auth/login", { method: "POST", body: { username, password } })),
    changePassword: (currentPassword: string, newPassword: string) => withSession(request("/auth/password", { method: "POST", body: { currentPassword, newPassword } })),
    async logout() {
      try { await request("/auth/logout", { method: "POST" }); }
      finally { csrfToken = ""; }
    },
    /** The server-side B2B gate; it fails with APPLICATION_ACCESS_DENIED once B2B access is removed. */
    access: async () => mapAccess(await request<unknown>("/b2b/access")),
  };
}
