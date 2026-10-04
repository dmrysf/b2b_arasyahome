import { expect, test, type Page } from "@playwright/test";
import { API, mockApi } from "./mock-api";

/** Companies V1 in the production build, against the in-memory API double (no PHP, database or network). */
const foreignRequests: string[] = [];
test.beforeEach(async ({ page }) => {
  foreignRequests.length = 0;
  page.on("pageerror", (error) => { throw error; });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== API && url.hostname !== "127.0.0.1" && url.protocol !== "data:") foreignRequests.push(request.url());
  });
});
test.afterEach(() => { expect(foreignRequests).toEqual([]); });

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

async function seedThree(api: Awaited<ReturnType<typeof mockApi>>) {
  const mobila = api.companies.seed({ legalName: "Mobila Lux SRL", taxIdentifier: "RO12345678", address: { type: "billing", countryCode: "RO", city: "Cluj-Napoca", addressLine1: "Str. Mare 1", isPrimary: true }, contact: { name: "Ana Pop", isPrimary: true } });
  api.companies.seed({ legalName: "Perdele Design SRL", taxIdentifier: "23456789" });
  api.companies.seed({ legalName: "Mobilya Lüks A.Ş.", countryCode: "TR", taxIdentifier: "1234567890" });
  return mobila;
}

test("the Companies list opens with search, status and country filters", async ({ page }) => {
  const api = await mockApi(page, { loggedIn: true });
  await seedThree(api);
  await page.goto("/companii");
  await expect(page.getByRole("heading", { name: "Companii", exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  const first = page.locator("tbody tr").first();
  await expect(first).toContainText("B2B-000001");
  await expect(first).toContainText("Mobila Lux SRL");
  await expect(first).toContainText("Cluj-Napoca");
  await expect(first).toContainText("România");
  await expect(first).toContainText("Ana Pop");
  await expect(first).toContainText("Activă");
  await page.getByLabel("Căutare").fill("perdele");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Perdele Design SRL");
  await page.getByLabel("Căutare").fill("");
  await page.getByLabel("Țară").selectOption("TR");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Turcia");
  await page.getByLabel("Stare").selectOption("inactive");
  await expect(page.getByText("Nicio companie nu corespunde căutării sau filtrelor.")).toBeVisible();
  expect(api.state.requests.filter((request) => request.startsWith("GET /b2b/companies")).length).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.getByRole("heading", { name: "Şirketler", exact: true })).toBeVisible();
  await expect(page.getByLabel("Arama")).toBeVisible();
  await expect(page.getByText("Arama veya filtrelerle eşleşen şirket yok.")).toBeVisible();
});

test("the list loads further pages from the server instead of holding everything", async ({ page }) => {
  const api = await mockApi(page, { loggedIn: true });
  for (let i = 1; i <= 60; i++) api.companies.seed({ legalName: `Client ${String(i).padStart(2, "0")} SRL`, taxIdentifier: `${10000000 + i}` });
  await page.goto("/companii");
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await expect(page.getByText("50 companii afișate")).toBeVisible();
  await page.getByRole("button", { name: "Încarcă mai multe" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(60);
  await expect(page.getByRole("button", { name: "Încarcă mai multe" })).toHaveCount(0);
  expect(api.state.requests.filter((request) => request === "GET /b2b/companies")).toHaveLength(2);
});

test("a company is created with a primary contact and address, once, with CSRF and an Idempotency-Key", async ({ page }) => {
  const api = await mockApi(page, { loggedIn: true });
  await page.goto("/companii");
  await page.getByRole("link", { name: "Companie nouă" }).click();
  await expect(page.getByRole("heading", { name: "Companie nouă" })).toBeVisible();
  await page.getByRole("button", { name: "Creează compania" }).click();
  await expect(page.getByText("Completați acest câmp.")).toHaveCount(2);
  expect(api.state.requests).not.toContain("POST /b2b/companies");
  await page.getByLabel("Denumire legală").fill("Textile Nord SRL");
  await page.getByLabel("CUI / Cod fiscal").fill("RO 445 566");
  await page.getByLabel("Adaugă persoana de contact principală").check();
  await page.getByLabel("Nume").fill("Ion Ionescu");
  await page.getByLabel("E-mail").fill("ion@textile-nord.ro");
  await page.getByLabel("Adaugă adresa principală").check();
  await page.getByRole("textbox", { name: "Adresă", exact: true }).fill("Bd. Unirii 10");
  await page.getByLabel("Oraș").fill("Iași");
  await page.getByRole("button", { name: "Creează compania" }).click();
  await expect(page.getByText("Compania a fost creată.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Textile Nord SRL" })).toBeVisible();
  await expect(page.getByText("B2B-000001").first()).toBeVisible();
  const index = api.state.requests.indexOf("POST /b2b/companies");
  expect(api.state.headers[index]["x-csrf-token"]).toBe("csrf-smoke");
  expect(api.state.headers[index]["idempotency-key"]).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{15,99}$/);
  expect(api.state.requests.filter((request) => request === "POST /b2b/companies")).toHaveLength(1);
  expect(api.companies.companies).toHaveLength(1);
  await page.getByRole("tab", { name: /Persoane de contact/ }).click();
  await expect(page.locator(".record-list li")).toContainText("Ion Ionescu");
  await expect(page.locator(".record-list li")).toContainText("Principală");
  await page.getByRole("tab", { name: /Adrese/ }).click();
  await expect(page.locator(".record-list li")).toContainText("Facturare");
  await expect(page.locator(".record-list li")).toContainText("Iași");
  expect(await page.evaluate(() => [Object.keys(localStorage), sessionStorage.length, document.cookie])).toEqual([[], 0, ""]);
});

test("a duplicate tax identifier is refused with a neutral message and a link to the existing company", async ({ page }) => {
  const api = await mockApi(page, { loggedIn: true });
  await seedThree(api);
  await page.goto("/companii/noua");
  await page.getByLabel("Denumire legală").fill("Alt Nume SRL");
  await page.getByLabel("CUI / Cod fiscal").fill("12.345.678");
  await page.getByRole("button", { name: "Creează compania" }).click();
  await expect(page.getByText("Există deja o companie cu acest cod fiscal în această țară. Companiile nu sunt unite automat.")).toBeVisible();
  await expect(page.getByLabel("Denumire legală")).toHaveValue("Alt Nume SRL");
  await page.getByRole("link", { name: "Deschide B2B-000001" }).click();
  await expect(page.getByRole("heading", { name: "Mobila Lux SRL" })).toBeVisible();
});

test("a concurrent edit keeps the employee's work and shows the current values before saving again", async ({ page }) => {
  const api = await mockApi(page, { loggedIn: true });
  const id = await seedThree(api);
  await page.goto(`/companii/${id}`);
  await page.getByRole("button", { name: "Editează" }).click();
  await page.getByLabel("Denumire comercială").fill("Mobila Lux Premium");
  api.companies.externalEdit(id, { displayName: "Mobila Lux (coleg)", website: "https://mobila-lux.ro" });
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Înregistrarea a fost modificată între timp de altcineva.")).toBeVisible();
  await expect(page.getByLabel("Denumire comercială")).toHaveValue("Mobila Lux Premium");
  await page.getByRole("button", { name: "Încarcă versiunea actuală" }).click();
  await expect(page.getByText("Câmpurile marcate au fost schimbate și de altcineva", { exact: false })).toBeVisible();
  await expect(page.locator(".current-value")).toHaveText("Valoarea actuală: Mobila Lux (coleg)");
  await expect(page.getByLabel("Denumire comercială")).toHaveValue("Mobila Lux Premium");
  await expect(page.getByLabel("Website")).toHaveValue("https://mobila-lux.ro");
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Modificările au fost salvate.")).toBeVisible();
  await expect(page.locator(".facts")).toContainText("Mobila Lux Premium");
  await expect(page.locator(".facts")).toContainText("https://mobila-lux.ro");
});

test("status, contacts, addresses, notes and activity work from the detail page", async ({ page }) => {
  const api = await mockApi(page, { loggedIn: true });
  const id = await seedThree(api);
  await page.goto(`/companii/${id}`);
  await page.getByRole("button", { name: "Dezactivează" }).click();
  await expect(page.getByText("Compania va fi marcată inactivă.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Confirmă dezactivarea" }).click();
  await expect(page.getByText("Compania a fost dezactivată.")).toBeVisible();
  await expect(page.locator(".company-title")).toContainText("Inactivă");
  await page.getByRole("button", { name: "Reactivează" }).click();
  await page.getByRole("button", { name: "Confirmă reactivarea" }).click();
  await expect(page.getByText("Compania a fost reactivată.")).toBeVisible();

  await page.getByRole("tab", { name: /Persoane de contact/ }).click();
  await page.getByRole("button", { name: "Adaugă persoană de contact" }).click();
  await page.getByLabel("Nume").fill("Maria Ionescu");
  await page.getByLabel("Telefon").fill("0722 000 333");
  await page.getByLabel("Persoana de contact principală a companiei").check();
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Persoana de contact a fost salvată.")).toBeVisible();
  await expect(page.locator(".record-list li").filter({ hasText: "Maria Ionescu" })).toContainText("Principală");
  await expect(page.locator(".record-list li").filter({ hasText: "Ana Pop" })).not.toContainText("Principală");
  await page.locator(".record-list li").filter({ hasText: "Ana Pop" }).getByRole("button", { name: "Dezactivează" }).click();
  await page.getByRole("button", { name: "Confirmă dezactivarea" }).click();
  await expect(page.getByText("Persoana de contact a fost dezactivată.")).toBeVisible();
  await expect(page.locator(".record-list li").filter({ hasText: "Ana Pop" })).toHaveCount(0);
  await page.getByLabel("Arată și înregistrările inactive").check();
  await expect(page.locator(".record-list li").filter({ hasText: "Ana Pop" })).toContainText("Inactivă");

  await page.getByRole("tab", { name: /Adrese/ }).click();
  await page.getByRole("button", { name: "Adaugă adresă" }).click();
  await page.getByLabel("Tip adresă").selectOption("delivery");
  await page.getByRole("textbox", { name: "Adresă", exact: true }).fill("Str. Depozitului 5");
  await page.getByLabel("Oraș").fill("Turda");
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Adresa a fost salvată.")).toBeVisible();
  await expect(page.locator(".record-list li").filter({ hasText: "Turda" })).toContainText("Livrare");

  await page.getByRole("tab", { name: "Note interne" }).click();
  await page.getByRole("button", { name: "Editează notele" }).click();
  await page.getByRole("textbox", { name: "Note interne" }).fill("Preferă livrarea dimineața.");
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Notele interne au fost salvate.")).toBeVisible();
  await expect(page.locator(".notes")).toHaveText("Preferă livrarea dimineața.");

  await page.getByRole("tab", { name: "Activitate" }).click();
  await expect(page.locator(".timeline")).toContainText("Companie dezactivată");
  await expect(page.locator(".timeline")).toContainText("Persoană de contact adăugată");
  await expect(page.locator(".timeline")).toContainText("Câmpuri: Note interne");
  await expect(page.locator(".timeline")).not.toContainText("Preferă livrarea");
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.locator(".timeline")).toContainText("Şirket pasif yapıldı");
  await expect(page.getByRole("tab", { name: "Etkinlik" })).toBeVisible();
});

test("permissions shape what is offered; the server still decides", async ({ page }) => {
  const viewer = await mockApi(page, { loggedIn: true, permissions: ["b2b.companies.view"] });
  const id = await seedThree(viewer);
  await page.goto("/companii");
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Companie nouă" })).toHaveCount(0);
  await page.goto(`/companii/${id}`);
  await expect(page.getByRole("heading", { name: "Mobila Lux SRL" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Editează" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dezactivează" })).toHaveCount(0);
  await page.goto("/companii/noua");
  await expect(page.getByRole("heading", { name: "Companii", exact: true })).toBeVisible();
  await expect(page.getByLabel("Denumire legală")).toHaveCount(0);
});

test("an identity without company permissions sees no Companies module and a clear refusal", async ({ page }) => {
  const api = await mockApi(page, { loggedIn: true, permissions: [] });
  await page.goto("/");
  await expect(page.getByRole("navigation").getByRole("link")).toHaveText(["Pagina principală"]);
  await page.goto("/companii");
  await expect(page.getByRole("heading", { name: "Nu aveți permisiunea de a vedea companiile." })).toBeVisible();
  expect(api.state.requests.filter((request) => request.startsWith("GET /b2b/companies"))).toEqual([]);
  await page.getByRole("button", { name: "TR — Türkçe" }).click();
  await expect(page.getByRole("heading", { name: "Şirketleri görüntüleme yetkiniz yok." })).toBeVisible();
});

test("create-only access registers a company without revealing company data", async ({ page }) => {
  const api = await mockApi(page, { loggedIn: true, permissions: ["b2b.companies.create"] });
  await page.goto("/companii");
  await expect(page.getByText("Puteți înregistra companii noi, dar nu aveți permisiunea de a vedea lista.")).toBeVisible();
  await page.getByRole("link", { name: "Companie nouă" }).click();
  await page.getByLabel("Denumire legală").fill("Doar Creare SRL");
  await page.getByLabel("CUI / Cod fiscal").fill("99887766");
  await page.getByRole("button", { name: "Creează compania" }).click();
  await expect(page.getByText("Compania a fost creată. Nu aveți permisiunea de a-i vedea detaliile.")).toBeVisible();
  expect(api.companies.companies).toHaveLength(1);
});

test("a failed further page keeps the companies already shown", async ({ page }) => {
  const api = await mockApi(page, { loggedIn: true });
  for (let i = 1; i <= 55; i++) api.companies.seed({ legalName: `Firma ${String(i).padStart(2, "0")} SRL`, taxIdentifier: `${20000000 + i}` });
  await page.goto("/companii");
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await page.route(`${API}/b2b/companies?**`, (route) => route.abort("internetdisconnected"));
  await page.getByRole("button", { name: "Încarcă mai multe" }).click();
  await expect(page.getByText("Nu există conexiune cu serverul.")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(50);
});

for (const viewport of [{ width: 360, height: 760 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
  test(`${viewport.width}px: list, create and detail have no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const api = await mockApi(page, { loggedIn: true });
    const id = await seedThree(api);
    api.companies.seed({ legalName: "O denumire legală foarte lungă pentru o companie de distribuție en-gros din România SRL", taxIdentifier: "55667788", website: "https://un-domeniu-foarte-lung-pentru-test.ro" });
    await page.goto("/companii");
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await noHorizontalOverflow(page);
    await page.goto("/companii/noua");
    await page.getByLabel("Adaugă persoana de contact principală").check();
    await page.getByLabel("Adaugă adresa principală").check();
    await noHorizontalOverflow(page);
    await page.goto(`/companii/${id}`);
    await expect(page.getByRole("heading", { name: "Mobila Lux SRL" })).toBeVisible();
    await noHorizontalOverflow(page);
    for (const tab of [/Persoane de contact/, /Adrese/, "Note interne", "Activitate"]) {
      await page.getByRole("tab", { name: tab }).click();
      await noHorizontalOverflow(page);
    }
    await page.getByRole("button", { name: "TR — Türkçe" }).click();
    await page.getByRole("tab", { name: /Adresler/ }).click();
    await noHorizontalOverflow(page);
  });
}
