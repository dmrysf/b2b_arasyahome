import { expect, request, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Package 3 acceptance: the B2B screens used every day stay usable from a 320 px phone to a 1440 px desktop. Runs
// last, over the companies, orders, projects and accounts the earlier real-API specs created, and only reads.
const fixture = JSON.parse(readFileSync(new URL("./.real-api-fixture.json", import.meta.url), "utf8")) as {
  origins: { admin: string; b2b: string }; root: { username: string; password: string };
};
const API = "http://127.0.0.1:8789";

/** Page-level horizontal overflow plus any visible control cut off by the viewport outside its own scroll box. */
const clipped = (page: Page) => page.evaluate(() => {
  const width = document.documentElement.clientWidth;
  const scrollsInside = (el: Element) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(node).overflowX)) return true;
    }
    return false;
  };
  const cut = [...document.querySelectorAll("main button, main a.button, main input, main select, main textarea, header button, nav a")]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.left < -1 || r.right > width + 1) && !scrollsInside(el); })
    .map(el => `${el.tagName.toLowerCase()}: ${(el.textContent || el.getAttribute("aria-label") || el.getAttribute("name") || "").trim().slice(0, 40)}`);
  return { overflow: document.documentElement.scrollWidth - width, cut };
});

test("daily B2B screens fit 320–1440 px without page overflow or cut-off controls, and nothing is written", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("pageerror", error => { throw error; });
  // The Classic order editor previews totals with the stateless server calculator; that POST writes nothing.
  const writes: string[] = [];
  page.on("request", r => { if (r.url().startsWith(API) && r.method() !== "GET" && !/^\/(auth\/(login|logout)|b2b\/orders\/calculate)$/.test(new URL(r.url()).pathname)) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });

  const admin = await request.newContext();
  const login = await admin.post(API + "/auth/login", { headers: { Origin: fixture.origins.admin }, data: fixture.root });
  expect(login.status()).toBe(200);
  const first = async (path: string) => { const r = await admin.get(API + path, { headers: { Origin: fixture.origins.admin } }); expect(r.status(), path).toBe(200); return ((await r.json()).items ?? [])[0]; };
  const company = await first("/b2b/companies");
  const order = await first("/b2b/orders");
  const project = await first("/b2b/projects");
  const account = await first("/b2b/accounts");
  expect(company?.id && order?.id && project?.id && account?.companyId, "earlier specs created the data this sweep reads").toBeTruthy();

  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await page.getByLabel("Nume utilizator").fill(fixture.root.username);
  await page.getByLabel("Parolă", { exact: true }).fill(fixture.root.password);
  await page.getByRole("button", { name: "Intrare în cont" }).click();
  await expect(page.getByRole("heading", { name: /^Bun venit, / })).toBeVisible();

  const screens: Array<[string, string]> = [
    ["home", "/"],
    ["companies", "/companii"],
    ["company", `/companii/${company.id}`],
    ["orders", "/comenzi"],
    ["quick order", "/comenzi/noua"],
    ["order", `/comenzi/${order.id}`],
    ["projects", "/proiecte"],
    ["project", `/proiecte/${project.id}`],
    ["accounts", "/conturi-curente"],
    ["account", `/conturi-curente/${account.companyId}`],
  ];
  const problems: string[] = [];
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 740 : 900 });
    for (const [name, path] of screens) {
      await page.goto(path);
      await expect(page.locator("main h1").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const { overflow, cut } = await clipped(page);
      if (overflow > 0) problems.push(`${name} @${width}px scrolls horizontally by ${overflow}px`);
      for (const control of cut) problems.push(`${name} @${width}px cuts off ${control}`);
    }
  }
  expect(problems).toEqual([]);
  expect(writes).toEqual([]);
});
