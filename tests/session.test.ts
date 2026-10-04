import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApi } from "../src/api/client";
import { B2B_APPLICATION, classifySession, resolveSession, restoreSession } from "../src/auth/session";
import { accessPayload, API, apiError, fakeFetch, sessionPayload } from "./support";

const api = (handler: Parameters<typeof fakeFetch>[0]) => createApi(API, fakeFetch(handler).fetchImpl);

test("B2B is registered under the Central IAM application key b2b", () => {
  assert.equal(B2B_APPLICATION, "b2b");
});

test("loading resolves to the login screen when there is no central session", async () => {
  const state = await restoreSession(api(() => apiError("NO_SESSION", 401)));
  assert.equal(state.kind, "anonymous");
});

test("an authenticated identity with B2B access enters only after the server gate agrees", async () => {
  const paths: string[] = [];
  const state = await restoreSession(api((call) => {
    paths.push(call.url.pathname);
    return call.url.pathname === "/auth/session" ? { body: sessionPayload() } : { body: accessPayload() };
  }));
  assert.equal(state.kind, "ready");
  assert.deepEqual(paths, ["/auth/session", "/b2b/access"]);
  if (state.kind === "ready") assert.equal(state.access.employee.username, "elena.vanzari");
});

test("an authenticated identity without B2B access is denied without calling the gate", async () => {
  const paths: string[] = [];
  const state = await restoreSession(api((call) => { paths.push(call.url.pathname); return { body: sessionPayload({ applications: ["staff", "dashboard"] }) }; }));
  assert.equal(state.kind, "no-access");
  assert.deepEqual(paths, ["/auth/session"]);
});

test("a pending temporary password blocks B2B first, even with B2B access", async () => {
  const state = await restoreSession(api(() => ({ body: sessionPayload({ mustChangePassword: true }) })));
  assert.equal(state.kind, "password");
});

test("the server gate wins over a stale session list: access removed in between means no access", async () => {
  const state = await restoreSession(api((call) => (call.url.pathname === "/auth/session" ? { body: sessionPayload() } : apiError("APPLICATION_ACCESS_DENIED", 403))));
  assert.equal(state.kind, "no-access");
});

test("removing B2B access is reflected on the next authorization check", async () => {
  let granted = true;
  const client = api((call) => {
    if (call.url.pathname === "/auth/session") return { body: sessionPayload({ applications: granted ? ["b2b"] : [], authorizationVersion: granted ? 4 : 5 }) };
    return granted ? { body: accessPayload() } : apiError("APPLICATION_ACCESS_DENIED", 403);
  });
  assert.equal((await restoreSession(client)).kind, "ready");
  granted = false;
  assert.equal((await restoreSession(client)).kind, "no-access");
  assert.equal((await resolveSession(client, (await client.getSession()))).kind, "no-access");
});

test("a deactivated or revoked session returns to the login screen with a notice", async () => {
  for (const code of ["ACCOUNT_INACTIVE", "SESSION_EXPIRED"]) {
    const state = await restoreSession(api((call) => (call.url.pathname === "/auth/session" ? { body: sessionPayload() } : apiError(code, 401))));
    assert.equal(state.kind, "anonymous", code);
    if (state.kind === "anonymous") assert.equal((state.notice as ApiError).code, code);
  }
  const inactive = await restoreSession(api(() => apiError("ACCOUNT_INACTIVE", 401)));
  assert.equal(inactive.kind, "anonymous");
});

test("server or network failures become a retryable screen, never a fake session", async () => {
  assert.equal((await restoreSession(api(() => apiError("SERVER_ERROR", 500)))).kind, "unavailable");
  assert.equal((await restoreSession(createApi(API, (() => Promise.reject(new TypeError("offline"))) as typeof fetch))).kind, "unavailable");
});

test("classification has no frontend-only access flag", () => {
  assert.equal(classifySession(null).kind, "anonymous");
  const session = { employee: { employeeUuid: "x", displayName: "A", username: "a", applications: ["b2b"], isRoot: true, mustChangePassword: false, authorizationVersion: 1 }, expiresAt: "2026-10-05T00:00:00Z" };
  assert.equal(classifySession(session).kind, "needs-gate", "even root goes through the server gate");
  assert.equal(classifySession({ ...session, employee: { ...session.employee, applications: [] } }).kind, "no-access");
});
