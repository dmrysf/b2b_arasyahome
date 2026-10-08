import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../src/api/client";
import { createTranslator, DEFAULT_LOCALE, initialLocale, INTL_LOCALE, MESSAGES, saveLocale, type Locale } from "../src/i18n";
import { I18nProvider } from "../src/i18n/context";
import { LOCALE_STORAGE_KEY, type LocaleStorage } from "../src/i18n/storage";
import { ChangePasswordPage, LoginPage, NoAccessPage } from "../src/pages/AuthPages";
import { text } from "./support";

function memoryStorage(initial: Record<string, string> = {}): LocaleStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
}

const render = (locale: Locale, node: React.ReactNode) => text(renderToStaticMarkup(<I18nProvider locale={locale}>{node}</I18nProvider>));

test("Romanian is the default and the fallback", () => {
  assert.equal(DEFAULT_LOCALE, "ro");
  assert.equal(initialLocale(memoryStorage()), "ro");
  assert.equal(initialLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: "de" })), "ro", "an unknown stored value falls back to Romanian");
  assert.equal(initialLocale(null), "ro", "unavailable storage falls back to Romanian");
  const throwing: LocaleStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(initialLocale(throwing), "ro");
  assert.doesNotThrow(() => saveLocale("tr", throwing));
});

test("Turkish is a second complete language that matches the Romanian shape", () => {
  const shape = (value: unknown, prefix = ""): string[] => {
    if (typeof value === "function") return [`${prefix}()`];
    if (value && typeof value === "object") return Object.keys(value).sort().flatMap((key) => shape((value as Record<string, unknown>)[key], `${prefix}.${key}`));
    return [prefix];
  };
  assert.deepEqual(shape(MESSAGES.tr), shape(MESSAGES.ro));
  const leaves = (value: unknown): string[] => typeof value === "string" ? [value] : typeof value === "function" ? [String((value as (a: string) => string)("X"))] : value && typeof value === "object" ? Object.values(value).flatMap(leaves) : [];
  for (const leaf of leaves(MESSAGES.tr)) assert.ok(leaf.trim().length > 0);
  assert.equal(MESSAGES.ro.brand.title, "Arasya B2B");
  assert.equal(MESSAGES.ro.brand.product, "Management vânzări en-gros");
  assert.equal(MESSAGES.tr.brand.title, "Arasya B2B");
  assert.equal(MESSAGES.tr.brand.product, "Toptan Satış Yönetimi");
  assert.deepEqual(INTL_LOCALE, { ro: "ro-RO", tr: "tr-TR" });
});

test("the language choice persists under the single key arasya.b2b.locale", () => {
  assert.equal(LOCALE_STORAGE_KEY, "arasya.b2b.locale");
  const storage = memoryStorage();
  saveLocale("tr", storage);
  assert.deepEqual(Object.keys(storage.data), ["arasya.b2b.locale"]);
  assert.equal(storage.data["arasya.b2b.locale"], "tr");
  assert.equal(initialLocale(storage), "tr");
  saveLocale("ro", storage);
  assert.equal(initialLocale(storage), "ro");
});

test("the browser language is ignored", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "tr-TR", languages: ["tr-TR", "tr"] } });
  try {
    assert.equal(initialLocale(memoryStorage()), "ro");
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});

test("the login screen renders in Romanian and switches to Turkish", () => {
  const ro = render("ro", <LoginPage onLogin={async () => undefined} />);
  assert.match(ro, /Arasya B2B/);
  assert.match(ro, /Management vânzări en-gros/);
  assert.match(ro, /Autentificare/);
  assert.match(ro, /Nume utilizator/);
  assert.match(ro, /Intrare în cont/);
  const tr = render("tr", <LoginPage onLogin={async () => undefined} />);
  assert.match(tr, /Toptan Satış Yönetimi/);
  assert.match(tr, /Kullanıcı adı/);
  assert.match(tr, /Giriş yap/);
  assert.doesNotMatch(tr, /Autentificare|Nume utilizator|Parolă/);
});

test("access denied is localized and reveals no permission internals", () => {
  const ro = render("ro", <NoAccessPage displayName="Ion Popescu" onLogout={() => undefined} />);
  assert.match(ro, /Nu aveți acces la aplicația B2B\./);
  assert.match(ro, /Ion Popescu/);
  assert.match(ro, /Ieșire din cont/);
  const tr = render("tr", <NoAccessPage displayName="Ion Popescu" onLogout={() => undefined} />);
  assert.match(tr, /B2B uygulamasına erişim yetkiniz bulunmuyor\./);
  for (const html of [ro, tr]) assert.doesNotMatch(html, /b2b\.access|application_key|employee_application_access|APPLICATION_ACCESS_DENIED|permission/i);
});

test("the forced password change screen is localized", () => {
  const ro = render("ro", <ChangePasswordPage displayName="Ion" username="ion" onChange={async () => undefined} onLogout={() => undefined} />);
  assert.match(ro, /Setați parola personală.*Ion, contul folosește o parolă temporară/);
  assert.match(ro, /Pas obligatoriu Înainte de a accesa informațiile companiei/);
  const markup = renderToStaticMarkup(<I18nProvider locale="ro"><ChangePasswordPage displayName="Ion" username="ion" onChange={async () => undefined} onLogout={() => undefined} /></I18nProvider>);
  assert.match(markup, /role="note"/);
  for (const name of ["Afișează parola curentă", "Afișează noua parolă", "Afișează confirmarea parolei"]) assert.match(markup, new RegExp(`aria-label="${name}"`));
  assert.equal(markup.match(/class="password-toggle" aria-controls="[^"]+" aria-pressed="false"/g)?.length, 3);
  const tr = render("tr", <ChangePasswordPage displayName="Ion" username="ion" onChange={async () => undefined} onLogout={() => undefined} />);
  assert.match(tr, /Kişisel şifrenizi belirleyin.*Zorunlu adım/);
  const voluntary = render("ro", <ChangePasswordPage voluntary displayName="Ion" username="ion" onChange={async () => undefined} onLogout={() => undefined} onCancel={() => undefined} />);
  assert.match(voluntary, /Schimbați parola/);
  assert.doesNotMatch(voluntary, /Pas obligatoriu/);
  assert.match(voluntary, /Anulează/);
});

test("first-login checks run in Romanian before any request", async () => {
  const { passwordProblem } = await import("../src/pages/AuthPages");
  assert.equal(passwordProblem("Temp-2026-Password!", "o parolă personală lungă", "o parolă personală lungă", "nita.cristina"), null);
  assert.equal(passwordProblem("Temp-2026-Password!", "", "", "nita.cristina"), "passwordMissing");
  assert.equal(passwordProblem("Temp-2026-Password!", "scurtă", "scurtă", "nita.cristina"), "passwordTooShort");
  assert.equal(passwordProblem("Temp-2026-Password!", "Temp-2026-Password!", "Temp-2026-Password!", "nita.cristina"), "passwordSame");
  assert.equal(passwordProblem("Temp-2026-Password!", "NITA.cristina.2026!", "NITA.cristina.2026!", "nita.cristina"), "passwordContainsUsername");
  assert.equal(passwordProblem("Temp-2026-Password!", "o parolă personală lungă", "alta", "nita.cristina"), "passwordMismatch");
});

test("server text is never shown; failures use localized codes", () => {
  const ro = createTranslator("ro");
  const tr = createTranslator("tr");
  assert.equal(ro.problem(new ApiError("APPLICATION_ACCESS_DENIED", 403)), "Nu aveți acces la aplicația B2B.");
  assert.equal(tr.problem(new ApiError("APPLICATION_ACCESS_DENIED", 403)), "B2B uygulamasına erişim yetkiniz bulunmuyor.");
  assert.equal(ro.problem(new ApiError("SOMETHING_NEW", 500, "Internal stack trace")), MESSAGES.ro.errors.fallback);
  assert.equal(ro.problem(new Error("raw message")), MESSAGES.ro.errors.fallback);
  assert.match(ro.dateTime("2026-10-04T12:00:00Z"), /2026/);
  assert.equal(ro.dateTime("not a date"), "—");
});
