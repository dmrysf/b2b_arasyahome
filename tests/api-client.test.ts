import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApi } from "../src/api/client";
import { resolveApiBaseUrl } from "../src/config";
import { accessPayload, API, apiError, fakeFetch, sessionPayload } from "./support";

test("the API base URL is one exact HTTPS origin; loopback HTTP only in the isolated E2E build", () => {
  assert.equal(resolveApiBaseUrl("https://api.arasyahome.ro", ""), "https://api.arasyahome.ro");
  assert.equal(resolveApiBaseUrl("https://api.arasyahome.ro/", ""), "https://api.arasyahome.ro");
  for (const bad of ["", "http://api.arasyahome.ro", "https://api.arasyahome.ro/v1", "https://user:pass@api.arasyahome.ro", "https://api.arasyahome.ro?x=1", "http://127.0.0.1:8789", "http://localhost:8789"]) {
    assert.throws(() => resolveApiBaseUrl(bad, ""), Error, bad);
  }
  assert.equal(resolveApiBaseUrl("http://127.0.0.1:8789", "127.0.0.1"), "http://127.0.0.1:8789");
  assert.throws(() => resolveApiBaseUrl("http://localhost:8789", "127.0.0.1"));
});

test("every request goes to the central API with the HttpOnly cookie and no cache; the CSRF token stays in memory", async () => {
  const { fetchImpl, calls } = fakeFetch((call) => {
    if (call.url.pathname === "/auth/session") return { body: sessionPayload({}, "csrf-abc") };
    if (call.url.pathname === "/b2b/access") return { body: accessPayload() };
    return { body: { ok: true } };
  });
  const api = createApi(API, fetchImpl);
  const session = await api.getSession();
  assert.equal(session?.employee.username, "elena.vanzari");
  assert.deepEqual(session?.employee.applications, ["b2b"]);
  assert.equal("csrfToken" in (session ?? {}), false, "the CSRF token is not exposed to UI state");
  assert.equal((await api.access()).application, "b2b");
  await api.logout();
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.origin}${call.url.pathname}`), [
    "GET https://api.arasyahome.ro/auth/session",
    "GET https://api.arasyahome.ro/b2b/access",
    "POST https://api.arasyahome.ro/auth/logout",
  ]);
  for (const call of calls) {
    assert.equal(call.credentials, "include");
    assert.equal(call.cache, "no-store");
    assert.equal(call.headers.Authorization, undefined, "no bearer token is ever sent");
  }
  assert.equal(calls[0].headers["X-CSRF-Token"], undefined, "reads carry no CSRF header");
  assert.equal(calls[2].headers["X-CSRF-Token"], "csrf-abc", "mutations carry the in-memory CSRF token");
});

test("logout forgets the CSRF token", async () => {
  const { fetchImpl, calls } = fakeFetch((call) => (call.url.pathname === "/auth/session" ? { body: sessionPayload({}, "csrf-1") } : { body: { ok: true } }));
  const api = createApi(API, fetchImpl);
  await api.getSession();
  await api.logout();
  await api.logout();
  assert.equal(calls[1].headers["X-CSRF-Token"], "csrf-1");
  assert.equal(calls[2].headers["X-CSRF-Token"], undefined);
});

test("login and password change use the existing Central IAM endpoints", async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ body: sessionPayload({ mustChangePassword: true }, "csrf-login") }));
  const api = createApi(API, fetchImpl);
  const session = await api.login("elena.vanzari", "temporary pass");
  assert.equal(session.employee.mustChangePassword, true);
  await api.changePassword("temporary pass", "a new long passphrase");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.pathname}`), ["POST /auth/login", "POST /auth/password"]);
  assert.deepEqual(calls[0].body, { username: "elena.vanzari", password: "temporary pass" });
  assert.equal(calls[1].headers["X-CSRF-Token"], "csrf-login");
});

test("an absent or expired session is anonymous, not an error", async () => {
  for (const code of ["NO_SESSION", "SESSION_EXPIRED"]) {
    const { fetchImpl } = fakeFetch(() => apiError(code, 401));
    assert.equal(await createApi(API, fetchImpl).getSession(), null);
  }
});

test("malformed session or gate payloads fail closed", async () => {
  const badSession = fakeFetch(() => ({ body: { ...sessionPayload(), employee: { ...sessionPayload().employee, applications: "b2b" } } }));
  await assert.rejects(createApi(API, badSession.fetchImpl).getSession(), (error: unknown) => error instanceof ApiError && error.code === "INVALID_RESPONSE");
  const badGate = fakeFetch(() => ({ body: { ...accessPayload(), application: "dashboard" } }));
  await assert.rejects(createApi(API, badGate.fetchImpl).access(), (error: unknown) => error instanceof ApiError && error.code === "INVALID_RESPONSE");
});

test("access removal and session expiry on a protected request notify the app", async () => {
  const seen: string[] = [];
  let answer = apiError("APPLICATION_ACCESS_DENIED", 403);
  const { fetchImpl } = fakeFetch(() => answer);
  const api = createApi(API, fetchImpl);
  api.onSessionProblem((error) => seen.push(error.code));
  await assert.rejects(api.access(), (error: unknown) => error instanceof ApiError && error.code === "APPLICATION_ACCESS_DENIED");
  answer = apiError("SESSION_EXPIRED", 401);
  await assert.rejects(api.access());
  answer = apiError("INVALID_CREDENTIALS", 401);
  await assert.rejects(api.login("x", "y"));
  assert.deepEqual(seen, ["APPLICATION_ACCESS_DENIED", "SESSION_EXPIRED"], "login failures are reported by the form, not as a session problem");
});

test("transport failures become NETWORK_UNAVAILABLE without leaking details", async () => {
  const api = createApi(API, (() => Promise.reject(new TypeError("getaddrinfo ENOTFOUND api.arasyahome.ro"))) as typeof fetch);
  await assert.rejects(api.getSession(), (error: unknown) => error instanceof ApiError && error.code === "NETWORK_UNAVAILABLE" && !error.message.includes("ENOTFOUND"));
});
