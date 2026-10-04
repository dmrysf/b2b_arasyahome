import type { SessionEmployee } from "../src/api/types";

export const API = "https://api.arasyahome.ro";

/** The exact /auth/session employee shape of Operations API 2.7.0 (EmployeeSerializer::safe). */
export function sessionPayload(employee: Partial<SessionEmployee & { permissions: string[] }> = {}, csrfToken = "csrf-token-1") {
  return {
    employee: {
      employeeUuid: "11111111-1111-4111-8111-111111111111",
      employeeCode: null,
      displayName: "Elena Vânzări",
      username: "elena.vanzari",
      department: "Vânzări",
      departmentKey: "vanzari",
      role: "employee",
      status: "active",
      permissions: ["b2b.access", "profile.view_self"],
      allowedStageIds: [],
      applications: ["b2b"],
      roles: [],
      positionTitle: null,
      isRoot: false,
      mustChangePassword: false,
      authorizationVersion: 4,
      locale: "ro",
      ...employee,
    },
    expiresAt: "2026-10-05T06:00:00+00:00",
    csrfToken,
  };
}

export function accessPayload(overrides: { displayName?: string; username?: string; isRoot?: boolean; authorizationVersion?: number } = {}) {
  return {
    application: "b2b",
    employee: { displayName: overrides.displayName ?? "Elena Vânzări", username: overrides.username ?? "elena.vanzari", isRoot: overrides.isRoot ?? false },
    authorizationVersion: overrides.authorizationVersion ?? 4,
  };
}

export type Call = { url: URL; method: string; headers: Record<string, string>; body: unknown; credentials?: RequestCredentials; cache?: RequestCache };

/** A scripted fetch: each handler answers one request and every request is recorded for assertions. */
export function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      credentials: init.credentials,
      cache: init.cache,
    };
    calls.push(call);
    const answer = await handler(call);
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function apiError(code: string, status: number) {
  return { status, body: { error: { code, message: "server-side English text that must never be shown", requestId: "req-1" } } };
}

export const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
