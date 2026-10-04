import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { createApi } from "../src/api/client";
import { I18nProvider } from "../src/i18n/context";
import type { Locale } from "../src/i18n";
import { Shell } from "../src/layout/Shell";
import { PLANNED_MODULES } from "../src/layout/modules";
import { HomePage } from "../src/pages/HomePage";
import { B2B_VERSION } from "../src/version";
import { accessPayload, API, text } from "./support";

const access = { ...accessPayload(), application: "b2b" as const };
const session = { employee: { employeeUuid: "11111111-1111-4111-8111-111111111111", displayName: "Elena Vânzări", username: "elena.vanzari", applications: ["b2b"], isRoot: false, mustChangePassword: false, authorizationVersion: 4 }, expiresAt: "2026-10-05T06:00:00+00:00" };

const shell = (locale: Locale, isRoot = false) => renderToStaticMarkup(
  <I18nProvider locale={locale}>
    <Shell access={{ ...access, employee: { ...access.employee, isRoot } }} pathname="/" navigate={() => undefined} onLogout={() => undefined}>
      <HomePage access={{ ...access, employee: { ...access.employee, isRoot } }} session={session} />
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

test("future modules are visible only as disabled placeholders without links or data", () => {
  const html = shell("ro");
  const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(links, ["/"], "the only navigation link is the B2B home page");
  for (const label of ["Panou de control", "Companii", "Comenzi", "Conturi curente", "Proiecte", "Produse", "Rapoarte"]) assert.match(text(html), new RegExp(label));
  assert.equal(PLANNED_MODULES.length, 7);
  assert.match(text(html), /În curând/);
  assert.doesNotMatch(text(html), /\b(RON|lei|€|\d+[.,]\d{2})\b/, "no prices, balances or amounts");
});

test("the shell is complete in Turkish", () => {
  const html = text(shell("tr"));
  for (const label of ["Toptan Satış Yönetimi", "Hoş geldiniz, Elena Vânzări.", "Ana sayfa", "Yakında", "Firmalar", "Siparişler", "Cari hesaplar", "Projeler", "Ürünler", "Raporlar", "Çıkış yap", "B2B erişimi"]) {
    assert.ok(html.includes(label), label);
  }
  assert.doesNotMatch(html, /Pagina principală|Ieșire din cont|În curând|Companii/);
});
