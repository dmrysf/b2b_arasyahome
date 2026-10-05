import { expect, request, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(new URL("./.real-api-fixture.json", import.meta.url), "utf8")) as {
  origins: { admin: string; b2b: string }; root: { username: string; password: string }; projectUser: { username: string; temporaryPassword: string };
};
const API = "http://127.0.0.1:8789";
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("quick wholesale stays project-free; a field project is built, repeated, priced, converted once and produced with its location", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("pageerror", error => { throw error; });
  const routes: string[] = [];
  page.on("request", r => { if (r.url().startsWith(API)) routes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  const admin = await request.newContext();
  const login = await admin.post(API + "/auth/login", { headers: { Origin: fixture.origins.admin }, data: fixture.root });
  const csrf = (await login.json()).csrfToken as string;
  const headers = () => ({ Origin: fixture.origins.admin, "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() });
  const company = await admin.post(API + "/b2b/companies", { headers: headers(), data: { legalName: "Hotel Litoral SRL", countryCode: "RO", taxIdentifier: "PRJ-E2E-1" } });
  expect(company.status()).toBe(201);

  await page.goto("/");
  await page.getByLabel("Nume utilizator").fill(fixture.projectUser.username);
  await page.getByLabel("Parolă", { exact: true }).fill(fixture.projectUser.temporaryPassword);
  await page.getByRole("button", { name: "Intrare în cont" }).click();
  await page.getByLabel("Parola actuală").fill(fixture.projectUser.temporaryPassword);
  await page.getByLabel("Parola nouă", { exact: true }).fill("project field e2e permanent 2026");
  await page.getByLabel("Confirmați parola nouă").fill("project field e2e permanent 2026");
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page.getByRole("heading", { name: "Bun venit, Radu Proiecte." })).toBeVisible();

  // Quick wholesale: one click from home to the Classic order workstation, no project, room or window anywhere.
  await page.getByRole("link", { name: /Comandă rapidă/ }).click();
  await expect(page).toHaveURL(/\/comenzi\/noua$/);
  await expect(page.getByText("Comandă en-gros · intrare rapidă").first()).toBeVisible();
  await expect(page.locator("main").getByText(/Fereastr|Cameră|Proiect/)).toHaveCount(0);
  await page.goto("/");

  // New project with a generated hotel structure.
  await page.getByRole("link", { name: /Proiect nou/ }).click();
  await page.getByRole("radio", { name: "Hotel" }).check();
  await page.getByLabel("Caută companie activă").fill("Hotel Litoral");
  await expect(page.getByLabel("Companie", { exact: true }).locator("option", { hasText: "Hotel Litoral SRL" })).toHaveCount(1);
  await page.getByLabel("Companie", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("Nume proiect").fill("Hotel Litoral — renovare");
  await page.getByLabel("Structură inițială (opțional)").check();
  await page.getByLabel("Etaje", { exact: true }).fill("2");
  await page.getByLabel("Camere pe etaj").fill("3");
  await page.getByLabel("Ferestre pe cameră").fill("1");
  await expect(page.getByRole("status").filter({ hasText: "2 etaje · 6 camere · 6 ferestre" })).toBeVisible();
  await page.getByRole("button", { name: "Creează proiectul" }).click();
  await expect(page.getByRole("heading", { name: "Hotel Litoral — renovare" })).toBeVisible();
  const projectId = /\/proiecte\/([0-9a-f-]{36})/.exec(page.url())![1];
  const nav = page.getByRole("complementary", { name: "Structură" });
  await expect(nav.getByRole("button", { name: /Camera 101/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /Camera 203/ })).toBeVisible();

  // Measurements and a treatment, saved automatically after a pause.
  const window1 = page.getByRole("article", { name: "Fereastra 1" });
  await window1.getByLabel("Lățime (cm)").first().fill("160");
  await window1.getByLabel("Înălțime (cm)").first().fill("240");
  await window1.getByLabel("Montaj").selectOption("ceiling");
  await window1.getByRole("button", { name: "+ Adaugă tratament" }).click();
  const treatment = window1.locator(".treatment-row").first();
  await expect(treatment).toBeVisible();
  await treatment.getByLabel("Cod produs").fill("VOAL-IV");
  await treatment.getByLabel("Metri total").fill("5,4");
  await treatment.getByLabel("Preț unitar net").fill("45");
  await expect(page.getByRole("status").filter({ hasText: "Toate modificările sunt salvate" })).toBeVisible({ timeout: 15_000 });
  const outline = await (await admin.get(`${API}/b2b/projects/${projectId}`)).json();
  const room101 = outline.zones[0].rooms[0].id as string;
  let room = await (await admin.get(`${API}/b2b/projects/${projectId}/rooms/${room101}`)).json();
  expect(room.room.openings[0].width).toBe("160.000");
  expect(room.room.openings[0].treatments[0]).toMatchObject({ productCode: "VOAL-IV", meters: "5.400", unitPriceNet: "45.00", totals: { gross: "289.17" } });
  await expect(page.locator(".elevation svg")).toBeVisible();

  // Offline while typing: nothing lost, retried with the same key, applied once.
  await page.context().setOffline(true);
  await treatment.getByLabel("Culoare").fill("Ivory");
  await expect(page.getByRole("status").filter({ hasText: "Fără conexiune — reîncercare automată" })).toBeVisible({ timeout: 15_000 });
  await page.context().setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "Toate modificările sunt salvate" })).toBeVisible({ timeout: 40_000 });
  room = await (await admin.get(`${API}/b2b/projects/${projectId}/rooms/${room101}`)).json();
  expect(room.room.openings[0].treatments[0].color).toBe("Ivory");
  expect(room.room.openings[0].treatments[0].version).toBe(3);

  // Repetition: two copies of room 101 in floor 1, independent afterwards.
  await page.getByRole("button", { name: "Duplică camera" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Număr de copii").fill("2");
  await dialog.getByLabel("Primul număr").fill("104");
  await expect(dialog).toContainText("Camera 104, Camera 105");
  await dialog.getByRole("button", { name: "Aplică" }).click();
  await expect(nav.getByRole("button", { name: /Camera 105/ })).toBeVisible();
  const after = await (await admin.get(`${API}/b2b/projects/${projectId}`)).json();
  expect(after.project.counts).toMatchObject({ rooms: 8, openings: 8, treatments: 3 });

  // Proposal PDF and conversion of room 101 into one Classic draft.
  const [proposal] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Ofertă PDF" }).click()]);
  expect(proposal.suggestedFilename()).toMatch(/^oferta-B2B-PRJ-\d{6}-rev\d+\.pdf$/);
  expect(readFileSync(await proposal.path()).subarray(0, 8).toString()).toBe("%PDF-1.4");
  await nav.getByRole("button", { name: /Camera 101/ }).click();
  await page.getByRole("button", { name: "Comandă din proiect" }).click();
  const convert = page.getByRole("dialog");
  await expect(convert.getByRole("status")).toContainText("1 produs ales");
  await convert.getByRole("button", { name: "Creează ciorna comenzii" }).click();
  await expect(page).toHaveURL(/\/comenzi\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: /Din proiectul B2B-PRJ-\d{6}/ })).toBeVisible();
  await expect(page.getByTestId("line-origin")).toContainText("Camera 101 · Fereastra 1");
  const orderId = /\/comenzi\/([0-9a-f-]{36})/.exec(page.url())![1];

  // The same scope cannot be converted twice; the workspace shows the line as ordered.
  const revision = (await (await admin.get(`${API}/b2b/projects/${projectId}`)).json()).project.revision as number;
  const again = await admin.post(`${API}/b2b/projects/${projectId}/orders`, { headers: headers(), data: { treatmentIds: [room.room.openings[0].treatments[0].id], expectedRevision: revision } });
  expect((await again.json()).error.code).toBe("ORDER_ALREADY_CREATED_FROM_SCOPE");

  // Classic lifecycle unchanged: finalize, explicit production, workshop sheet with location and no money.
  await page.getByRole("button", { name: "Finalizează", exact: true }).click();
  await page.getByRole("button", { name: "Confirmă finalizarea" }).click();
  await page.locator(".production-card").getByRole("button", { name: "Trimite în producție", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Confirm/ }).click();
  await expect(page.locator(".production-card")).toContainText("Etapa 1 din 14");
  const [sheet] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Fișă de producție (PDF)" }).click()]);
  expect(sheet.suggestedFilename()).toMatch(/^productie-B2B-ORD-\d{6}\.pdf$/);
  expect(readFileSync(await sheet.path()).subarray(0, 8).toString()).toBe("%PDF-1.4");

  // Project edits after finalization never touch the order.
  await page.goto(`/proiecte/${projectId}?camera=${room101}`);
  await expect(page.locator(".treatment-row").first()).toContainText("În comanda B2B-ORD-");
  await page.locator(".treatment-row").first().getByLabel("Preț unitar net").fill("99");
  await expect(page.getByRole("status").filter({ hasText: "Toate modificările sunt salvate" })).toBeVisible({ timeout: 15_000 });
  const order = await (await admin.get(`${API}/b2b/orders/${orderId}`)).json();
  expect(order.order.lines[0].unitPriceNet).toBe("45.00");
  expect(order.order.status).toBe("finalized");

  // Turkish and responsive tablet/phone widths without page-level horizontal overflow.
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.getByRole("button", { name: "PDF teklif" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pencereler ve açıklıklar" })).toBeVisible();
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [360, 740]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    expect(await overflow(page), `overflow at ${width}`).toBeLessThanOrEqual(0);
    if (width <= 1024) {
      const toggle = page.locator(".navigator-toggle");
      await expect(toggle).toBeVisible();
      await toggle.click();
      expect(await overflow(page), `overflow with navigator at ${width}`).toBeLessThanOrEqual(0);
      await toggle.click();
    }
  }
  await page.getByRole("button", { name: "RO — Română" }).click();
  expect(routes.every(r => / \/(auth|b2b)\//.test(r))).toBe(true);
  expect(routes.filter(r => r.startsWith("POST") && r.endsWith("/changes")).length).toBeLessThan(25);
  expect(await page.evaluate(() => [sessionStorage.length, Object.keys(localStorage)])).toEqual([0, ["arasya.b2b.locale"]]);
  await admin.dispose();
});
