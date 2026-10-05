import { expect, test, request } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixture = JSON.parse(readFileSync(new URL("./.real-api-fixture.json", import.meta.url), "utf8")) as {
  origins: { admin: string; b2b: string }; root: { username: string; password: string };
  accountUser: { username: string; temporaryPassword: string };
};
const API = "http://127.0.0.1:8789";
const snapshot = () => JSON.parse(execFileSync("php", [fileURLToPath(new URL("./db-snapshot.php", import.meta.url))], { encoding: "utf8", env: process.env })) as Record<string, unknown>;
const production = () => Object.fromEntries(Object.entries(snapshot()).filter(([key]) => key !== "b2b_companies"));

test("current account: receivables from finalized orders, payment with allocations, release, reversal, statements, no production effect", async ({ page }) => {
  const before = production(), routes: string[] = [];
  page.on("request", r => { if (r.url().startsWith(API)) routes.push(new URL(r.url()).pathname); });
  page.on("pageerror", error => { throw error; });
  const admin = await request.newContext();
  const auth = await admin.post(API + "/auth/login", { headers: { Origin: fixture.origins.admin }, data: fixture.root });
  expect(auth.status()).toBe(200);
  const csrf = (await auth.json()).csrfToken as string;
  const headers = () => ({ Origin: fixture.origins.admin, "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() });
  const created = await admin.post(API + "/b2b/companies", { headers: headers(), data: { legalName: "Cont Curent Client SRL", displayName: null, countryCode: "RO",
    taxIdentifier: "7734567", vatNumber: null, registrationNumber: null, website: null, internalNotes: null } });
  expect(created.status()).toBe(201);
  const companyId = (await created.json()).companyId as string;
  const line = { productCode: "C-ACC", productName: null, variant: null, color: null, kind: "curtain", width: null, height: null, quantity: 4, meters: "13.5",
    pricingUnit: "meter", unitPriceNet: "10.00", discountPercent: "0", vatPercent: "19", notes: null, productionNotes: null };
  const finalized = async (currencyCode: "RON" | "EUR") => {
    const draft = await admin.post(API + "/b2b/orders", { headers: headers(), data: { companyId, currencyCode, contactId: null, billingAddressId: null, deliveryAddressId: null, notes: null, lines: [line] } });
    expect(draft.status()).toBe(201);
    const order = (await draft.json()).detail.order as { id: string; code: string };
    expect((await admin.post(`${API}/b2b/orders/${order.id}/finalize`, { headers: headers(), data: { expectedVersion: 1 } })).status()).toBe(200);
    return order;
  };
  const first = await finalized("RON"), second = await finalized("RON");
  await finalized("EUR");

  await page.goto("/");
  await page.getByLabel("Nume utilizator").fill(fixture.accountUser.username);
  await page.getByLabel("Parolă", { exact: true }).fill(fixture.accountUser.temporaryPassword);
  await page.getByRole("button", { name: "Intrare în cont" }).click();
  await page.getByLabel("Parola actuală").fill(fixture.accountUser.temporaryPassword);
  await page.getByLabel("Parola nouă", { exact: true }).fill("current account e2e permanent 2026");
  await page.getByLabel("Confirmați parola nouă").fill("current account e2e permanent 2026");
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page.getByRole("heading", { name: "Bun venit, Ioana Contabil." })).toBeVisible();

  // Top-level navigation: the overview lists the server balances per currency.
  await page.getByRole("navigation").getByRole("link", { name: "Conturi curente", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Conturi curente", level: 1 })).toBeVisible();
  const row = page.getByRole("row", { name: /Cont Curent Client SRL/ });
  await expect(row).toContainText("321,30 RON");
  await expect(row).toContainText("160,65 EUR");
  await row.getByRole("link", { name: "Cont Curent Client SRL" }).click();
  const ron = page.getByRole("region", { name: "Sold RON" });
  await expect(ron).toContainText("Compania datorează");
  await expect(ron).toContainText("321,30 RON");

  // Payment of 200.00 RON spread over both receivables; the server answers with the new balance.
  await page.getByRole("button", { name: "Înregistrează plată" }).click();
  const payment = page.getByRole("form", { name: "Plată nouă" });
  await payment.getByLabel("Sumă", { exact: true }).fill("200");
  await payment.getByRole("button", { name: "Înregistrează" }).click();
  await expect(payment.getByText("Completați acest câmp.")).toBeVisible();
  await payment.getByLabel(/^Referință/).fill("OP-2026-1");
  await payment.getByRole("row", { name: new RegExp(first.code) }).getByRole("button", { name: "Alocă restul" }).click();
  await expect(payment.getByLabel(`Sumă ${first.code}`)).toHaveValue("160.65");
  await payment.getByLabel(`Sumă ${second.code}`).fill("39,35");
  await expect(payment.getByRole("status")).toContainText("Nealocat: 0,00");
  await payment.getByRole("button", { name: "Înregistrează" }).click();
  await expect(page.getByText("Plata a fost înregistrată.")).toBeVisible();
  await expect(ron).toContainText("121,30 RON");

  // Allocation detail and a manual release.
  const paymentRow = page.locator(".movement").filter({ hasText: "OP-2026-1" });
  await paymentRow.getByRole("button", { name: "Detalii" }).click();
  await expect(paymentRow.locator(".allocation-list li")).toHaveCount(2);
  await paymentRow.locator(".allocation-list li").filter({ hasText: second.code }).getByRole("button", { name: "Eliberează alocarea" }).click();
  await paymentRow.getByLabel("Motivul eliberării").fill("Alocare greșită");
  await paymentRow.getByRole("button", { name: "Confirmă eliberarea" }).click();
  await expect(page.getByText("Alocarea a fost eliberată.")).toBeVisible();
  await expect(ron).toContainText("121,30 RON");

  // Reversal: the payment stays, a linked opposite movement restores the balance.
  const reversible = page.locator(".movement").filter({ hasText: "OP-2026-1" });
  await reversible.getByRole("button", { name: "Stornează" }).click();
  await reversible.getByLabel("Motiv").fill("Plată respinsă de bancă");
  await reversible.getByRole("button", { name: "Confirmă stornarea" }).click();
  await expect(page.getByText("Mișcarea a fost stornată.")).toBeVisible();
  await expect(ron).toContainText("321,30 RON");
  await expect(page.locator(".movement").filter({ hasText: "OP-2026-1" })).toContainText(/Stornată prin B2B-MV-\d{6}/);

  // A credit adjustment in EUR, with its mandatory reason.
  await page.getByRole("button", { name: "Ajustare", exact: true }).click();
  const adjustment = page.getByRole("form", { name: "Ajustare manuală" });
  await adjustment.getByLabel("Monedă").selectOption("EUR");
  await adjustment.getByLabel("Sens").selectOption("credit");
  await adjustment.getByLabel("Sumă", { exact: true }).fill("5,50");
  await adjustment.getByLabel("Motiv").fill("Discount comercial");
  await adjustment.getByRole("button", { name: "Înregistrează" }).click();
  await expect(page.getByText("Ajustarea a fost înregistrată.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Sold EUR" })).toContainText("155,15 EUR");

  // Cancelling a finalized order posts its automatic reversal.
  expect((await admin.post(`${API}/b2b/orders/${second.id}/cancel`, { headers: headers(), data: { expectedVersion: 2 } })).status()).toBe(200);
  await page.reload();
  await expect(ron).toContainText("160,65 RON");
  await expect(page.locator(".movement").filter({ hasText: "Comandă anulată — stornare automată" })).toHaveCount(1);

  // Statement on screen and as files rendered by the server.
  const statement = page.getByRole("region", { name: "Extras de cont" });
  await statement.getByRole("button", { name: "Afișează" }).click();
  await expect(statement.locator("tr.statement-edge").last()).toContainText("160,65 RON");
  const [csv] = await Promise.all([page.waitForEvent("download"), statement.getByRole("button", { name: "Descarcă CSV" }).click()]);
  expect(csv.suggestedFilename()).toMatch(/^extras-B2B-\d{6}-RON-\d{4}-\d{2}-\d{2}\.csv$/);
  const csvText = readFileSync(await csv.path(), "utf8");
  expect(csvText).toContain('"Sold la sfârșitul perioadei";"160.65"');
  const [pdf] = await Promise.all([page.waitForEvent("download"), statement.getByRole("button", { name: "Descarcă PDF" }).click()]);
  expect(readFileSync(await pdf.path()).subarray(0, 8).toString()).toBe("%PDF-1.4");

  // The same account is a tab of the company detail page, and the module is complete in Turkish.
  await page.getByRole("link", { name: "Fișa companiei" }).click();
  await page.getByRole("tab", { name: "Cont curent" }).click();
  await expect(page.getByRole("region", { name: "Sold RON" })).toContainText("160,65 RON");
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.getByRole("tab", { name: "Cari hesap" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Cari hesaplar", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Bakiye RON" })).toContainText("Şirketin borcu");

  // Phone width: the account page never scrolls horizontally (wide tables scroll inside their own box).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/conturi-curente/${companyId}`);
  await page.getByRole("region", { name: "Hesap ekstresi" }).getByRole("button", { name: "Göster" }).click();
  await expect(page.getByRole("region", { name: "Hesap ekstresi" }).locator("table")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // Server truth: balance = ledger, and nothing reached production.
  const summary = await (await admin.get(`${API}/b2b/accounts/${companyId}`)).json();
  expect(summary.currencies.RON.balance).toBe("160.65");
  expect(summary.currencies.EUR.balance).toBe("155.15");
  expect(production()).toEqual(before);
  expect(routes.every(path => /^\/(auth\/|b2b\/)/.test(path))).toBe(true);
  expect(await page.evaluate(() => [sessionStorage.length, Object.keys(localStorage)])).toEqual([0, ["arasya.b2b.locale"]]);
  await admin.dispose();
});
