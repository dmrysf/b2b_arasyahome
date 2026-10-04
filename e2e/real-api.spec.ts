import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

type Identity = { id: string; username: string; name: string; temporaryPassword: string };
type Fixture = { origins: { b2b: string; admin: string }; root: { username: string; password: string }; b2bUser: Identity; staffUser: Identity; salesRoleId: number };

const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, ".real-api-fixture.json"), "utf8")) as Fixture;
const API = "http://127.0.0.1:8789";
const NEW_PASSWORD = { b2b: "vanzari e2e permanent passphrase 2026", staff: "atelier e2e permanent passphrase 2026" };
const snapshot = () => JSON.parse(execFileSync("php", [path.join(import.meta.dirname, "db-snapshot.php")], { env: process.env, encoding: "utf8" })) as Record<string, number | string>;
const production = (counts: Record<string, number | string>) => Object.fromEntries(Object.entries(counts).filter(([key]) => key !== "b2b_companies"));

test.describe.configure({ mode: "serial" });

let productionBefore: Record<string, number | string>;
let admin: APIRequestContext;
let adminCsrf = "";
const browserRequests: string[] = [];

/** The root identity acting from the Dashboard origin through the real management API, as an administrator would. */
async function adminCall(method: "PUT" | "POST", url: string, data?: unknown) {
  const response = await admin.fetch(`${API}${url}`, { method, data, headers: { Origin: fixture.origins.admin, "X-CSRF-Token": adminCsrf } });
  expect(response.status(), `${method} ${url}`).toBe(200);
  return response.json();
}

type CompanyJson = { legalName: string; displayName: string | null; countryCode: string; taxIdentifier: string; vatNumber: string | null; registrationNumber: string | null; website: string | null; internalNotes: string | null; version: number };
type AdminBody = { items: Array<{ id: string }>; company: CompanyJson; error: { code: string } };

/** Root acting on B2B company endpoints from the second allowed origin: another employee's concurrent work. */
async function adminFetch(method: "GET" | "PUT" | "POST", url: string, data?: unknown) {
  const headers: Record<string, string> = { Origin: fixture.origins.admin, "X-CSRF-Token": adminCsrf };
  if (method !== "GET") headers["Idempotency-Key"] = `e2e-admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const response = await admin.fetch(`${API}${url}`, { method, data, headers });
  return { status: response.status(), body: await response.json() as AdminBody };
}

const welcome = (page: Page) => page.getByRole("heading", { name: `Bun venit, ${fixture.b2bUser.name}.` });

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
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

test("6 a sales employee creates a company with a server code, adds a contact and an address, edits it and sees the activity", async ({ page }) => {
  track(page);
  await login(page, fixture.b2bUser.username, NEW_PASSWORD.b2b);
  await expect(welcome(page)).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Companii" }).click();
  await expect(page.getByText("Nu există încă nicio companie activă.")).toBeVisible();
  await page.getByRole("link", { name: "Companie nouă" }).click();
  await page.getByLabel("Denumire legală").fill("Mobila Lux E2E SRL");
  await page.getByLabel("CUI / Cod fiscal").fill("RO 12 345 678");
  await page.getByRole("button", { name: "Creează compania" }).click();
  await expect(page.getByText("Compania a fost creată.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mobila Lux E2E SRL" })).toBeVisible();
  await expect(page.locator(".company-title .eyebrow")).toHaveText(/^B2B-\d{6}$/);
  expect(page.url()).toMatch(/\/companii\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  await page.getByRole("tab", { name: /Persoane de contact/ }).click();
  await page.getByRole("button", { name: "Adaugă persoană de contact" }).click();
  await page.getByLabel("Nume").fill("Ana Pop");
  await page.getByLabel("E-mail").fill(" Ana.Pop@Mobila-Lux.RO ");
  await page.getByLabel("Persoana de contact principală a companiei").check();
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Persoana de contact a fost salvată.")).toBeVisible();
  await expect(page.locator(".record-list li")).toContainText("ana.pop@mobila-lux.ro");
  await expect(page.locator(".record-list li")).toContainText("Principală");

  await page.getByRole("tab", { name: /Adrese/ }).click();
  await page.getByRole("button", { name: "Adaugă adresă" }).click();
  await page.getByRole("textbox", { name: "Adresă", exact: true }).fill("Str. Fabricii 12");
  await page.getByLabel("Oraș").fill("Cluj-Napoca");
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Adresa a fost salvată.")).toBeVisible();
  await expect(page.locator(".record-list li")).toContainText("Facturare");

  await page.getByRole("tab", { name: "Informații companie" }).click();
  await page.getByRole("button", { name: "Editează" }).click();
  await page.getByLabel("Denumire comercială").fill("Mobila Lux");
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Modificările au fost salvate.")).toBeVisible();

  await page.getByRole("tab", { name: "Activitate" }).click();
  for (const entry of ["Companie creată", "Persoană de contact adăugată", "Adresă adăugată", "Date companie modificate", "Câmpuri: Denumire comercială"]) {
    await expect(page.locator(".timeline")).toContainText(entry);
  }
  await expect(page.locator(".timeline")).not.toContainText("ana.pop@mobila-lux.ro");

  await page.goto("/companii/noua");
  await page.getByLabel("Denumire legală").fill("Alt Nume SRL");
  await page.getByLabel("CUI / Cod fiscal").fill("12345678");
  await page.getByRole("button", { name: "Creează compania" }).click();
  await expect(page.getByText("Există deja o companie cu acest cod fiscal în această țară.", { exact: false })).toBeVisible();
  await page.goto("/companii");
  await page.getByLabel("Căutare").fill("cluj");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Ana Pop");
});

test("7 a stale edit is refused with 409; the employee keeps their work and saves on the current version", async ({ page }) => {
  track(page);
  const list = await adminFetch("GET", "/b2b/companies?search=Mobila");
  expect(list.status).toBe(200);
  const id = list.body.items[0].id;
  const before = (await adminFetch("GET", `/b2b/companies/${id}`)).body.company;
  await login(page, fixture.b2bUser.username, NEW_PASSWORD.b2b);
  await expect(welcome(page)).toBeVisible();
  await page.goto(`/companii/${id}`);
  await page.getByRole("button", { name: "Editează" }).click();
  await page.getByLabel("Nr. Registrul Comerțului").fill("J12/345/2019");
  const fields = { legalName: before.legalName, displayName: before.displayName, countryCode: before.countryCode, taxIdentifier: before.taxIdentifier, vatNumber: before.vatNumber, registrationNumber: before.registrationNumber, website: "https://mobila-lux.ro", internalNotes: before.internalNotes };
  expect((await adminFetch("PUT", `/b2b/companies/${id}`, { ...fields, expectedVersion: before.version })).status).toBe(200);
  const stale = await adminFetch("PUT", `/b2b/companies/${id}`, { ...fields, website: null, expectedVersion: before.version });
  expect([stale.status, stale.body.error.code]).toEqual([409, "COMPANY_CHANGED"]);
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Înregistrarea a fost modificată între timp de altcineva.")).toBeVisible();
  await expect(page.getByLabel("Nr. Registrul Comerțului")).toHaveValue("J12/345/2019");
  await page.getByRole("button", { name: "Încarcă versiunea actuală" }).click();
  await expect(page.getByLabel("Website")).toHaveValue("https://mobila-lux.ro");
  await expect(page.getByLabel("Nr. Registrul Comerțului")).toHaveValue("J12/345/2019");
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Modificările au fost salvate.")).toBeVisible();
  const after = (await adminFetch("GET", `/b2b/companies/${id}`)).body.company;
  expect([after.registrationNumber, after.website, after.version]).toEqual(["J12/345/2019", "https://mobila-lux.ro", before.version + 2]);
});

test("8 deactivate, filter inactive and reactivate; Turkish and a phone screen work", async ({ page }) => {
  track(page);
  const id = (await adminFetch("GET", "/b2b/companies?search=Mobila")).body.items[0].id;
  await login(page, fixture.b2bUser.username, NEW_PASSWORD.b2b);
  await expect(welcome(page)).toBeVisible();
  await page.goto(`/companii/${id}`);
  await page.getByRole("button", { name: "Dezactivează" }).click();
  await page.getByRole("button", { name: "Confirmă dezactivarea" }).click();
  await expect(page.getByText("Compania a fost dezactivată.")).toBeVisible();
  await page.goto("/companii");
  await expect(page.getByText("Nu există încă nicio companie activă.")).toBeVisible();
  await page.getByLabel("Stare").selectOption("inactive");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Inactivă");
  await page.locator("tbody tr a").click();
  await page.getByRole("button", { name: "Reactivează" }).click();
  await page.getByRole("button", { name: "Confirmă reactivarea" }).click();
  await expect(page.getByText("Compania a fost reactivată.")).toBeVisible();
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.getByRole("tab", { name: "Şirket bilgileri" })).toBeVisible();
  await page.getByRole("tab", { name: "Etkinlik" }).click();
  await expect(page.locator(".timeline")).toContainText("Şirket pasif yapıldı");
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await page.goto("/companii");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "RO — Română" }).click();
});

test("9 removing B2B access in Central IAM closes B2B on the next authorization check", async ({ page }) => {
  track(page);
  await adminCall("PUT", `/management/employees/${fixture.b2bUser.id}/applications`, { applications: ["b2b"] });
  await login(page, fixture.b2bUser.username, NEW_PASSWORD.b2b);
  await expect(page.getByRole("heading", { name: `Bun venit, ${fixture.b2bUser.name}.` })).toBeVisible();
  await adminCall("PUT", `/management/employees/${fixture.b2bUser.id}/applications`, { applications: [] });
  const denied = await page.evaluate(async (api) => {
    const response = await fetch(`${api}/b2b/companies`, { credentials: "include" });
    return `${response.status} ${(await response.json()).error?.code}`;
  }, API);
  expect(denied).toBe("403 APPLICATION_ACCESS_DENIED");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("heading", { name: "Nu aveți acces la aplicația B2B." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nu aveți acces la aplicația B2B." })).toBeVisible();
  await adminCall("PUT", `/management/employees/${fixture.b2bUser.id}/applications`, { applications: ["b2b"] });
  await page.reload();
  await expect(page.getByRole("heading", { name: `Bun venit, ${fixture.b2bUser.name}.` })).toBeVisible();
});

test("10 deactivation in Central IAM ends the B2B session", async ({ page }) => {
  track(page);
  await login(page, fixture.b2bUser.username, NEW_PASSWORD.b2b);
  await expect(page.getByRole("heading", { name: `Bun venit, ${fixture.b2bUser.name}.` })).toBeVisible();
  await adminCall("POST", `/management/employees/${fixture.b2bUser.id}/deactivate`);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("heading", { name: "Autentificare" })).toBeVisible();
  await adminCall("POST", `/management/employees/${fixture.b2bUser.id}/activate`);
});

test("11 root enters B2B through the existing root semantics, then logs out", async ({ page }) => {
  track(page);
  await login(page, fixture.root.username, fixture.root.password);
  await expect(page.getByRole("heading", { name: /^Bun venit, / })).toBeVisible();
  await expect(page.locator(".badge-root")).toHaveText("Administrator principal");
  await page.getByRole("button", { name: "Ieșire din cont" }).click();
  await expect(page.getByRole("heading", { name: "Autentificare" })).toBeVisible();
  const after = await page.evaluate(async (api) => (await fetch(`${api}/auth/session`, { credentials: "include" })).status, API);
  expect(after).toBe(401);
});

test("12 no production data was created or mutated and the browser talked only to B2B and the Operations API", () => {
  const after = snapshot();
  expect(production(after)).toEqual(production(productionBefore));
  expect(productionBefore.operational_orders).toBe(0);
  expect([productionBefore.b2b_companies, after.b2b_companies]).toEqual([0, 1]);
  const origins = new Set(browserRequests.map((entry) => new URL(entry.split(" ")[1]).origin));
  expect([...origins].sort()).toEqual([API, fixture.origins.b2b].sort());
  const apiRoutes = new Set(browserRequests.filter((entry) => entry.includes(API)).map((entry) => entry.replace(API, "")));
  const company = "b2b\\/companies(\\/[0-9a-f-]{36}(\\/(activity|deactivate|reactivate|(contacts|addresses)(\\/[0-9a-f-]{36}(\\/(deactivate|reactivate))?)?))?)?";
  for (const route of apiRoutes) expect(route, route).toMatch(new RegExp(`^(GET|POST|PUT|OPTIONS) \\/(auth\\/(session|login|logout|password)|b2b\\/access|${company}|orders\\/mine|management\\/(me|orders))$`));
  expect([...apiRoutes].filter((route) => /^(POST|PUT) /.test(route) && !route.includes("/auth/") && !route.includes("/b2b/companies"))).toEqual([]);
});
