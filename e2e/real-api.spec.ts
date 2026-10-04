import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

type Identity = { id: string; username: string; name: string; temporaryPassword: string };
type Fixture = { origins: { b2b: string; admin: string }; root: { username: string; password: string }; b2bUser: Identity; staffUser: Identity };

const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, ".real-api-fixture.json"), "utf8")) as Fixture;
const API = "http://127.0.0.1:8789";
const NEW_PASSWORD = { b2b: "vanzari e2e permanent passphrase 2026", staff: "atelier e2e permanent passphrase 2026" };
const snapshot = () => JSON.parse(execFileSync("php", [path.join(import.meta.dirname, "db-snapshot.php")], { env: process.env, encoding: "utf8" })) as Record<string, number>;

test.describe.configure({ mode: "serial" });

let productionBefore: Record<string, number>;
let admin: APIRequestContext;
let adminCsrf = "";
const browserRequests: string[] = [];

/** The root identity acting from the Dashboard origin through the real management API, as an administrator would. */
async function adminCall(method: "PUT" | "POST", url: string, data?: unknown) {
  const response = await admin.fetch(`${API}${url}`, { method, data, headers: { Origin: fixture.origins.admin, "X-CSRF-Token": adminCsrf } });
  expect(response.status(), `${method} ${url}`).toBe(200);
  return response.json();
}

function track(page: Page) {
  page.on("pageerror", (error) => { throw error; });
  page.on("request", (request) => {
    const url = new URL(request.url());
    browserRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
  });
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Nume utilizator").fill(username);
  await page.getByLabel("Parolă").fill(password);
  await page.getByRole("button", { name: "Intrare în cont" }).click();
}

async function changePassword(page: Page, current: string, next: string) {
  await expect(page.getByRole("heading", { name: "Schimbați parola" })).toBeVisible();
  await page.getByLabel("Parola actuală").fill(current);
  await page.getByLabel("Parola nouă", { exact: true }).fill(next);
  await page.getByLabel("Confirmați parola nouă").fill(next);
  await page.getByRole("button", { name: "Salvează parola" }).click();
}

test.beforeAll(async () => {
  productionBefore = snapshot();
  admin = await playwrightRequest.newContext();
  const login = await admin.post(`${API}/auth/login`, { data: { username: fixture.root.username, password: fixture.root.password }, headers: { Origin: fixture.origins.admin } });
  expect(login.status()).toBe(200);
  adminCsrf = (await login.json()).csrfToken;
});

test.afterAll(async () => { await admin.dispose(); });

test("1 a B2B identity logs in with the central account, changes the temporary password and enters B2B", async ({ page }) => {
  track(page);
  await login(page, fixture.b2bUser.username, fixture.b2bUser.temporaryPassword);
  await changePassword(page, fixture.b2bUser.temporaryPassword, NEW_PASSWORD.b2b);
  await expect(page.getByRole("heading", { name: `Bun venit, ${fixture.b2bUser.name}.` })).toBeVisible();
  await expect(page.getByText("Acces B2B")).toBeVisible();
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: [], session: 0, cookie: "" });
  const cookies = await page.context().cookies(API);
  expect(cookies.map((cookie) => [cookie.name, cookie.httpOnly, cookie.sameSite])).toEqual([["arasya_session", true, "Lax"]]);
});

test("2 RO and TR, and the same central session is reused after a reload", async ({ page }) => {
  track(page);
  await login(page, fixture.b2bUser.username, NEW_PASSWORD.b2b);
  await expect(page.getByRole("heading", { name: `Bun venit, ${fixture.b2bUser.name}.` })).toBeVisible();
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.getByRole("heading", { name: `Hoş geldiniz, ${fixture.b2bUser.name}.` })).toBeVisible();
  await expect(page.getByText("Toptan Satış Yönetimi").first()).toBeVisible();
  const loginsBefore = browserRequests.filter((entry) => entry.endsWith("/auth/login")).length;
  await page.reload();
  await expect(page.getByRole("heading", { name: `Hoş geldiniz, ${fixture.b2bUser.name}.` })).toBeVisible();
  expect(browserRequests.filter((entry) => entry.endsWith("/auth/login")).length).toBe(loginsBefore);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(["arasya.b2b.locale"]);
});

test("3 an identity without B2B access sees the refusal; the server enforces it independently", async ({ page }) => {
  track(page);
  await login(page, fixture.staffUser.username, fixture.staffUser.temporaryPassword);
  await changePassword(page, fixture.staffUser.temporaryPassword, NEW_PASSWORD.staff);
  await expect(page.getByRole("heading", { name: "Nu aveți acces la aplicația B2B." })).toBeVisible();
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.getByRole("heading", { name: "B2B uygulamasına erişim yetkiniz bulunmuyor." })).toBeVisible();
  const direct = await page.evaluate(async (api) => {
    const response = await fetch(`${api}/b2b/access`, { credentials: "include" });
    return { status: response.status, code: (await response.json()).error?.code };
  }, API);
  expect(direct).toEqual({ status: 403, code: "APPLICATION_ACCESS_DENIED" });
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
});

test("4 B2B access opens no production or management route", async ({ page }) => {
  track(page);
  await login(page, fixture.b2bUser.username, NEW_PASSWORD.b2b);
  await expect(page.getByRole("heading", { name: `Bun venit, ${fixture.b2bUser.name}.` })).toBeVisible();
  const statuses = await page.evaluate(async (api) => Promise.all(["/orders/mine", "/management/me", "/management/orders"].map(async (route) => {
    const response = await fetch(`${api}${route}`, { credentials: "include" });
    return `${route} ${response.status} ${(await response.json()).error?.code}`;
  })), API);
  expect(statuses).toEqual(["/orders/mine 403 APPLICATION_ACCESS_DENIED", "/management/me 403 APPLICATION_ACCESS_DENIED", "/management/orders 403 APPLICATION_ACCESS_DENIED"]);
});

test("5 the exact B2B origin is accepted and hostile origins are rejected", async () => {
  const context = await playwrightRequest.newContext();
  const allowed = await context.fetch(`${API}/auth/login`, { method: "OPTIONS", headers: { Origin: fixture.origins.b2b, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-csrf-token" } });
  expect(allowed.status()).toBe(204);
  expect(allowed.headers()["access-control-allow-origin"]).toBe(fixture.origins.b2b);
  expect(allowed.headers()["access-control-allow-credentials"]).toBe("true");
  for (const hostile of ["https://evil.example", "http://127.0.0.1:4179.evil.example", "http://localhost:4179", "null"]) {
    const preflight = await context.fetch(`${API}/auth/login`, { method: "OPTIONS", headers: { Origin: hostile, "Access-Control-Request-Method": "POST" } });
    expect(preflight.status(), hostile).toBe(403);
    expect(preflight.headers()["access-control-allow-origin"]).toBeUndefined();
    const post = await context.post(`${API}/auth/login`, { data: { username: fixture.b2bUser.username, password: NEW_PASSWORD.b2b }, headers: { Origin: hostile } });
    expect(post.status(), hostile).toBe(403);
    expect((await post.json()).error.code).toBe("ORIGIN_DENIED");
  }
  const read = await context.get(`${API}/health`, { headers: { Origin: "https://evil.example" } });
  expect(read.headers()["access-control-allow-origin"]).toBeUndefined();
  await context.dispose();
});

test("6 removing B2B access in Central IAM closes B2B on the next authorization check", async ({ page }) => {
  track(page);
  await adminCall("PUT", `/management/employees/${fixture.b2bUser.id}/applications`, { applications: ["b2b"] });
  await login(page, fixture.b2bUser.username, NEW_PASSWORD.b2b);
  await expect(page.getByRole("heading", { name: `Bun venit, ${fixture.b2bUser.name}.` })).toBeVisible();
  await adminCall("PUT", `/management/employees/${fixture.b2bUser.id}/applications`, { applications: [] });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("heading", { name: "Nu aveți acces la aplicația B2B." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nu aveți acces la aplicația B2B." })).toBeVisible();
  await adminCall("PUT", `/management/employees/${fixture.b2bUser.id}/applications`, { applications: ["b2b"] });
  await page.reload();
  await expect(page.getByRole("heading", { name: `Bun venit, ${fixture.b2bUser.name}.` })).toBeVisible();
});

test("7 deactivation in Central IAM ends the B2B session", async ({ page }) => {
  track(page);
  await login(page, fixture.b2bUser.username, NEW_PASSWORD.b2b);
  await expect(page.getByRole("heading", { name: `Bun venit, ${fixture.b2bUser.name}.` })).toBeVisible();
  await adminCall("POST", `/management/employees/${fixture.b2bUser.id}/deactivate`);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("heading", { name: "Autentificare" })).toBeVisible();
  await adminCall("POST", `/management/employees/${fixture.b2bUser.id}/activate`);
});

test("8 root enters B2B through the existing root semantics, then logs out", async ({ page }) => {
  track(page);
  await login(page, fixture.root.username, fixture.root.password);
  await expect(page.getByRole("heading", { name: /^Bun venit, / })).toBeVisible();
  await expect(page.locator(".badge-root")).toHaveText("Administrator principal");
  await page.getByRole("button", { name: "Ieșire din cont" }).click();
  await expect(page.getByRole("heading", { name: "Autentificare" })).toBeVisible();
  const after = await page.evaluate(async (api) => (await fetch(`${api}/auth/session`, { credentials: "include" })).status, API);
  expect(after).toBe(401);
});

test("9 no production data was created or mutated and the browser talked only to B2B and the Operations API", () => {
  expect(snapshot()).toEqual(productionBefore);
  expect(productionBefore.operational_orders).toBe(0);
  expect(productionBefore.b2b_tables).toBe(0);
  const origins = new Set(browserRequests.map((entry) => new URL(entry.split(" ")[1]).origin));
  expect([...origins].sort()).toEqual([API, fixture.origins.b2b].sort());
  const apiRoutes = new Set(browserRequests.filter((entry) => entry.includes(API)).map((entry) => entry.replace(API, "")));
  for (const route of apiRoutes) expect(route, route).toMatch(/^(GET|POST|OPTIONS) \/(auth\/(session|login|logout|password)|b2b\/access|orders\/mine|management\/(me|orders))$/);
  expect([...apiRoutes].filter((route) => route.startsWith("POST") && !route.includes("/auth/"))).toEqual([]);
});
