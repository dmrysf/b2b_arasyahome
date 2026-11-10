import { expect, request, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// B2B 0.10.1 on Operations API 2.68.0 with its production defaults: order types off, finance gate off. The API still sends
// the gate state of every order and a route for every production card; neither may show "order type not chosen", route
// details or the finance panel. Synthetic data in the disposable e2e database only.
const fixture = JSON.parse(readFileSync(new URL("./.real-api-fixture.json", import.meta.url), "utf8")) as {
  origins: { admin: string; b2b: string }; root: { username: string; password: string };
};
const API = "http://127.0.0.1:8789";
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("production defaults: no finance panel, no order type, no route details; stage and progress stay; RO/TR; 360/390/606 px", async ({ page }) => {
  test.setTimeout(120_000);
  page.on("pageerror", error => { throw error; });
  const admin = await request.newContext();
  const login = await admin.post(API + "/auth/login", { headers: { Origin: fixture.origins.admin }, data: fixture.root });
  expect(login.status()).toBe(200); const csrf = (await login.json()).csrfToken as string;
  const headers = () => ({ Origin: fixture.origins.admin, "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() });
  const access = await (await admin.get(API + "/b2b/access", { headers: { Origin: fixture.origins.admin } })).json();
  expect(access.features).toEqual([]);
  const run = Date.now().toString(36).toUpperCase(), legalName = `Defaults Synthetic ${run} SRL`;
  const company = await admin.post(API + "/b2b/companies", { headers: headers(), data: { legalName, countryCode: "RO", taxIdentifier: `DEF-E2E-${run}` } });
  expect(company.status()).toBe(201); const companyId = (await company.json()).companyId as string;
  const created = await admin.post(API + "/b2b/orders", { headers: headers(), data: { companyId, currencyCode: "RON", contactId: null, billingAddressId: null, deliveryAddressId: null,
    customerReference: null, notes: null, productionNotes: null, lines: [{ id: null, kind: "curtain", productCode: "DEF-1", productName: null, variant: null, color: null, width: null, height: null,
      quantity: 2, meters: "6.5", pricingUnit: "meter", unitPriceNet: "10.00", discountPercent: "0", vatPercent: "19", notes: null, productionNotes: null }] } });
  expect(created.status()).toBe(201); const id = (await created.json()).detail.order.id as string;
  // The data that 0.10.0 wrongly treated as a switch is really sent.
  expect((await (await admin.get(`${API}/b2b/orders/${id}`)).json()).order.financeGate).toMatchObject({ configured: true, finalizationMode: "off" });

  await page.goto("/");
  await page.getByLabel("Nume utilizator").fill(fixture.root.username);
  await page.getByLabel("Parolă", { exact: true }).fill(fixture.root.password);
  await page.getByRole("button", { name: "Intrare în cont" }).click();
  await expect(page.getByRole("heading", { name: /^Bun venit, / })).toBeVisible();

  await page.goto("/comenzi/noua");
  await expect(page.getByRole("heading", { name: "Comandă nouă" })).toBeVisible();
  await expect(page.locator("fieldset.order-type")).toHaveCount(0);

  await page.goto(`/comenzi/${id}`);
  const card = page.locator(".production-card");
  await expect(card).toContainText("Finalizați comanda");
  await expect(page.getByTestId("finance-panel")).toHaveCount(0);
  await expect(page.getByText("Eligibilitate financiară")).toHaveCount(0);
  await expect(page.getByTestId("order-type-badge")).toHaveCount(0);
  await page.getByRole("button", { name: "Finalizează", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Finalizați această comandă? Datele comerciale devin definitive.");
  await expect(page.getByTestId("confirm-order-type")).toHaveCount(0);
  await page.getByRole("button", { name: "Confirmă finalizarea" }).click();
  // Finalized read-only details: no order type.
  await expect(page.getByTestId("frozen-order-type")).toHaveCount(0);
  await card.getByRole("button", { name: "Trimite în producție", exact: true }).click();
  // Submission dialog: neither the type nor the sentence that the route follows the frozen order type (B2B 0.10.2).
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Trimiteți comanda în producție?");
  await expect(page.getByTestId("production-confirm-type")).toHaveCount(0);
  await expect(page.getByTestId("production-confirm-route")).toHaveCount(0);
  await expect(dialog).not.toContainText("Traseul este stabilit de server");
  await page.getByRole("button", { name: "Confirmă trimiterea" }).click();
  await expect(card).toContainText("Trimisă în producție");
  await expect(card).toContainText("Etapa 1 din 14");
  await expect(card.locator("progress")).toHaveAttribute("max", "14");
  expect((await (await admin.get(`${API}/b2b/orders/${id}/production`)).json()).production.route, "the server sends a route").toBeTruthy();
  await expect(page.getByTestId("production-route")).toHaveCount(0);
  await expect(card).not.toContainText("Tip neales");
  await expect(card).not.toContainText("Traseu de producție");
  await expect(page.getByTestId("finance-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(card).toContainText("14");
  await expect(card).not.toContainText("Sipariş tipi");
  await expect(card).not.toContainText("Üretim rotası");
  await page.getByRole("button", { name: "RO — Română" }).click();

  for (const width of [360, 390, 606]) {
    await page.setViewportSize({ width, height: 780 });
    await page.reload(); await expect(card).toContainText("Etapa 1 din 14");
    expect(await overflow(page), `order at ${width}px`).toBeLessThanOrEqual(0);
  }
  const requests = await admin.get(`${API}/b2b/accounts/${companyId}/finance-requests`);
  expect(requests.status()).toBe(200); expect((await requests.json()).items).toEqual([]);
  await page.goto(`/conturi-curente/${companyId}`);
  await expect(page.getByRole("heading", { name: legalName }).first()).toBeVisible();
  await expect(page.locator("[role=alert]")).toHaveCount(0);
  await expect(page.getByTestId("account-finance-requests")).toHaveCount(0);
});
