import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { createApi } from "../src/api/client";
import { I18nProvider } from "../src/i18n/context";
import type { Locale } from "../src/i18n";
import type { B2bAccess } from "../src/api/types";
import { Shell } from "../src/layout/Shell";
import { PLANNED_MODULES } from "../src/layout/modules";
import { HomePage } from "../src/pages/HomePage";
import { B2B_VERSION } from "../src/version";
import { accessPayload, ALL_COMPANY_PERMISSIONS, API, text } from "./support";

const access = { ...accessPayload(), application: "b2b" as const, permissions: [...ALL_COMPANY_PERMISSIONS] };
const session = { employee: { employeeUuid: "11111111-1111-4111-8111-111111111111", displayName: "Elena Vânzări", username: "elena.vanzari", applications: ["b2b"], isRoot: false, mustChangePassword: false, authorizationVersion: 4 }, expiresAt: "2026-10-05T06:00:00+00:00" };

const shell = (locale: Locale, isRoot = false, permissions: B2bAccess["permissions"] = access.permissions) => renderToStaticMarkup(
  <I18nProvider locale={locale}>
    <Shell access={{ ...access, permissions, employee: { ...access.employee, isRoot } }} pathname="/" navigate={() => undefined} onLogout={() => undefined}>
      <HomePage access={{ ...access, permissions, employee: { ...access.employee, isRoot } }} session={session} navigate={() => undefined} />
    </Shell>
  </I18nProvider>,
);

test("the app starts by checking the central session, with no fake identity", () => {
  const html = text(renderToStaticMarkup(<I18nProvider locale="ro"><App apiBaseUrl={API} api={createApi(API, (() => new Promise(() => undefined)) as typeof fetch)} /></I18nProvider>));
  assert.match(html, /Se verifică sesiunea…/);
  assert.doesNotMatch(html, /Elena|Bun venit/);
});

test("the shell shows the B2B brand, the identity from Central IAM and logout", () => {
  const html = text(shell("ro"));
  assert.match(html, /Arasya B2B/);
  assert.match(html, /Management vânzări en-gros/);
  assert.match(html, /Bun venit, Elena Vânzări\./);
  assert.match(html, /elena\.vanzari/);
  assert.match(html, /Ieșire din cont/);
  assert.match(html, new RegExp(`Versiunea ${B2B_VERSION.replace(/\./g, "\\.")}`));
  assert.match(html, /Acces B2B Activ/);
  assert.doesNotMatch(html, /Administrator principal/);
  assert.match(text(shell("ro", true)), /Administrator principal/);
});

test("company-only grants offer neither Orders nor Current Accounts; future modules remain placeholders", () => {
  const html = shell("ro");
  const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(links)], ["/", "/companii"], "navigation links: home and Companies");
  for (const label of ["Panou de control", "Companii", "Produse", "Rapoarte"]) assert.match(text(html), new RegExp(label));
  assert.doesNotMatch(text(html), /Proiecte (În curând|Disponibil)/, "projects are a real module, offered only with permission");
  assert.doesNotMatch(text(html), /Comandă rapidă|Proiect nou/, "entry points need their create permissions");
  assert.doesNotMatch(text(html), /Conturi curente (În curând|Disponibil)/, "not a placeholder and not offered without permission");
  assert.equal(PLANNED_MODULES.length, 3);
  assert.ok(!PLANNED_MODULES.includes("projects" as never));
  assert.ok(!PLANNED_MODULES.includes("accounts" as never));
  assert.ok(!PLANNED_MODULES.includes("orders" as never));
  assert.ok(!PLANNED_MODULES.includes("companies" as never));
  assert.match(text(html), /În curând/);
  assert.match(text(html), /Companii Disponibil/);
  assert.doesNotMatch(text(html), /\b(RON|lei|€|\d+[.,]\d{2})\b/, "no prices, balances or amounts");
});

test("without a company permission the Companies module is not offered", () => {
  const html = shell("ro", false, []);
  const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(links, ["/"]);
  assert.doesNotMatch(text(html), /Disponibil/);
});

test("the shell is complete in Turkish", () => {
  const html = text(shell("tr", false, [...access.permissions, "b2b.orders.view", "b2b.accounts.view"]));
  for (const label of ["Toptan Satış Yönetimi", "Hoş geldiniz, Elena Vânzări.", "Ana sayfa", "Yakında", "Şirketler", "Siparişler", "Cari hesaplar", "Projeler", "Ürünler", "Raporlar", "Çıkış yap", "B2B erişimi"]) {
    assert.ok(html.includes(label), label);
  }
  assert.doesNotMatch(html, /Pagina principală|Ieșire din cont|În curând|Companii/);
});

test("order-only access offers Orders without granting Companies", () => {
  const html = shell("ro", false, ["b2b.orders.view"]);
  assert.match(html, /href="\/comenzi"/);
  assert.doesNotMatch(html, /href="\/companii"/);
});

test("home separates the quick wholesale order from field project work, each only with its permissions", () => {
  const all = [...ALL_COMPANY_PERMISSIONS, "b2b.orders.view", "b2b.orders.create", "b2b.projects.view", "b2b.projects.create"] as B2bAccess["permissions"];
  const html = shell("ro", false, all);
  assert.match(html, /href="\/comenzi\/noua"[^>]*>.*Comandă rapidă/s);
  assert.match(html, /href="\/proiecte\/nou"[^>]*>.*Proiect nou/s);
  assert.match(html, /href="\/proiecte"/);
  const tr = text(shell("tr", false, all));
  assert.match(tr, /Hızlı sipariş/); assert.match(tr, /Yeni proje/); assert.match(tr, /Projeler/);
  const quickOnly = shell("ro", false, [...ALL_COMPANY_PERMISSIONS, "b2b.orders.view", "b2b.orders.create"]);
  assert.match(quickOnly, /Comandă rapidă/); assert.doesNotMatch(quickOnly, /Proiect nou/);
});
