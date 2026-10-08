import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { API, mockApi } from "./mock-api";

const version = (JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")) as { version: string }).version;
const VIEWPORTS = [
  { name: "phone", width: 360, height: 740 },
  { name: "large phone", width: 414, height: 896 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1600, height: 1000 },
];

const foreignRequests: string[] = [];
test.beforeEach(async ({ page }) => {
  foreignRequests.length = 0;
  page.on("pageerror", (error) => { throw error; });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== API && !["127.0.0.1"].includes(url.hostname) && url.protocol !== "data:") foreignRequests.push(request.url());
  });
});
test.afterEach(() => { expect(foreignRequests).toEqual([]); });

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Nume utilizator").fill("elena.vanzari");
  await page.getByLabel("Parolă").fill("parola-corecta");
  await page.getByRole("button", { name: "Intrare în cont" }).click();
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("the production build starts on the Romanian login screen and reads the central session", async ({ page }) => {
  const api = await mockApi(page);
  await page.goto("/");
  await expect(page).toHaveTitle("Arasya B2B");
  await expect(page.locator("html")).toHaveAttribute("lang", "ro");
  await expect(page.getByRole("heading", { name: "Autentificare" })).toBeVisible();
  await expect(page.getByText("Management vânzări en-gros")).toBeVisible();
  expect(api.state.requests).toEqual(["GET /auth/session"]);
  const scripts = await page.locator("script[src]").evaluateAll((nodes) => nodes.map((node) => (node as HTMLScriptElement).src));
  expect(scripts.every((src) => src.startsWith("http://127.0.0.1:4178/assets/"))).toBe(true);
  const bundle = await (await page.request.get(scripts[0])).text();
  expect(bundle).toContain(API);
  expect(bundle).not.toMatch(/localhost:|127\.0\.0\.1/);
});

test("Turkish is complete, persists across reloads and is the only browser-storage entry", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.getByRole("heading", { name: "Giriş" })).toBeVisible();
  await expect(page.getByText("Toptan Satış Yönetimi")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await page.reload();
  await expect(page.getByLabel("Kullanıcı adı")).toBeVisible();
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: sessionStorage.length, cookies: document.cookie }))).toEqual({ local: ["arasya.b2b.locale"], session: 0, cookies: "" });
  await page.getByRole("button", { name: "RO — Română" }).click();
  await expect(page.getByRole("heading", { name: "Autentificare" })).toBeVisible();
});

test("the browser language never selects the interface language", async ({ browser }) => {
  const context = await browser.newContext({ locale: "tr-TR" });
  const page = await context.newPage();
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Autentificare" })).toBeVisible();
  await context.close();
});

test("a B2B-authorized identity enters the shell; no auth data is stored in the browser", async ({ page }) => {
  const api = await mockApi(page);
  await login(page);
  await expect(page.getByRole("heading", { name: "Bun venit, Elena Vânzări." })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link")).toHaveText(["Pagina principală", "Companii"]);
  await expect(page.getByText(`Versiunea ${version}`)).toBeVisible();
  expect(api.state.requests).toEqual(["GET /auth/session", "POST /auth/login", "GET /b2b/access"]);
  expect(api.state.headers.every((headers) => !("authorization" in headers))).toBe(true);
  expect(await page.evaluate(() => [Object.keys(localStorage), sessionStorage.length])).toEqual([[], 0]);
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.getByRole("heading", { name: "Hoş geldiniz, Elena Vânzări." })).toBeVisible();
  await expect(page.getByText("Cari hesaplar").first()).toBeVisible();
});

test("no fake business data is rendered", async ({ page }) => {
  await mockApi(page);
  await login(page);
  await expect(page.getByRole("heading", { name: "Bun venit, Elena Vânzări." })).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\b(RON|lei|EUR)\b|€|\b\d{2,}[.,]\d{2}\b/);
  expect(await page.locator("table").count()).toBe(0);
});

test("the session is reused on reload and logout ends it", async ({ page }) => {
  const api = await mockApi(page);
  await login(page);
  await expect(page.getByRole("heading", { name: "Bun venit, Elena Vânzări." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Bun venit, Elena Vânzări." })).toBeVisible();
  await page.getByRole("button", { name: "Ieșire din cont" }).click();
  await expect(page.getByRole("heading", { name: "Autentificare" })).toBeVisible();
  expect(api.state.requests).toContain("POST /auth/logout");
  const logout = api.state.headers[api.state.requests.indexOf("POST /auth/logout")];
  expect(logout["x-csrf-token"]).toBe("csrf-smoke");
});

test("an identity without B2B access sees the localized refusal and never reaches the gate", async ({ page }) => {
  const api = await mockApi(page, { applications: ["staff", "dashboard"] });
  await login(page);
  await expect(page.getByRole("heading", { name: "Nu aveți acces la aplicația B2B." })).toBeVisible();
  await expect(page.getByText("b2b.access")).toHaveCount(0);
  expect(api.state.requests).not.toContain("GET /b2b/access");
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.getByRole("heading", { name: "B2B uygulamasına erişim yetkiniz bulunmuyor." })).toBeVisible();
});

test("a forced temporary password change comes before B2B", async ({ page }) => {
  await mockApi(page, { mustChangePassword: true });
  await login(page);
  await expect(page.getByRole("heading", { name: "Setați parola personală" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Înainte de a accesa informațiile companiei");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.getByLabel("Parola actuală").fill("parola-corecta");
  await page.getByLabel("Parola nouă", { exact: true }).fill("o parolă nouă și lungă");
  await page.getByLabel("Confirmați parola nouă").fill("altă parolă nouă și lungă");
  await page.getByRole("button", { name: "Afișează parola curentă" }).click();
  await expect(page.getByLabel("Parola actuală")).toHaveAttribute("type", "text");
  await expect(page.getByLabel("Parola nouă", { exact: true })).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page.getByText("Confirmarea nu coincide cu parola nouă.")).toBeVisible();
  await page.getByLabel("Confirmați parola nouă").fill("o parolă nouă și lungă");
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page.getByRole("heading", { name: "Bun venit, Elena Vânzări." })).toBeVisible();
});

test("removing B2B access in Central IAM closes B2B on the next check", async ({ page }) => {
  const api = await mockApi(page);
  await login(page);
  await expect(page.getByRole("heading", { name: "Bun venit, Elena Vânzări." })).toBeVisible();
  api.removeAccess();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("heading", { name: "Nu aveți acces la aplicația B2B." })).toBeVisible();
});

test("a revoked session returns to login with a notice", async ({ page }) => {
  const api = await mockApi(page);
  await login(page);
  await expect(page.getByRole("heading", { name: "Bun venit, Elena Vânzări." })).toBeVisible();
  api.state.loggedIn = false;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("heading", { name: "Autentificare" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Sesiunea a expirat. Autentificați-vă din nou.");
});

test("a direct reload of an unknown SPA route stays inside the authenticated shell", async ({ page }) => {
  await mockApi(page, { loggedIn: true });
  await page.goto("/pagina-necunoscuta");
  await expect(page.getByRole("heading", { name: "Pagina nu există" })).toBeVisible();
  await page.getByRole("button", { name: "Înapoi la pagina principală" }).click();
  await expect(page.getByRole("heading", { name: "Bun venit, Elena Vânzări." })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}px: login and shell have no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockApi(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Autentificare" })).toBeVisible();
    await noHorizontalOverflow(page);
    await login(page);
    await expect(page.getByRole("heading", { name: "Bun venit, Elena Vânzări." })).toBeVisible();
    await noHorizontalOverflow(page);
    if (viewport.width <= 820) {
      await expect(page.getByRole("link", { name: "Pagina principală" })).not.toBeInViewport();
      await page.getByRole("button", { name: "Meniu" }).first().click();
      await expect(page.getByRole("link", { name: "Pagina principală" })).toBeInViewport();
      await noHorizontalOverflow(page);
      await page.getByRole("link", { name: "Pagina principală" }).click();
      await expect(page.getByRole("link", { name: "Pagina principală" })).not.toBeInViewport();
    } else {
      await expect(page.getByRole("link", { name: "Pagina principală" })).toBeVisible();
    }
    await page.getByRole("button", { name: "TR — Türkçe" }).click();
    await expect(page.getByRole("heading", { name: "Hoş geldiniz, Elena Vânzări." })).toBeVisible();
    await noHorizontalOverflow(page);
  });
}
