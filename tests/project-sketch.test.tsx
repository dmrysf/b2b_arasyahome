import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Scene } from "../src/api/projects";
import type { Locale } from "../src/i18n";
import { I18nProvider } from "../src/i18n/context";
import { ElevationPreview } from "../src/projects/ElevationPreview";
import { text } from "./support";

type SceneOpening = Scene["rooms"][number]["openings"][number];
const opening: SceneOpening = {
  id: "00000000-0000-4000-8000-000000000011", name: "Fereastra 1", type: "window", wallIndex: 2, width: 160, height: 240.5, sillHeight: 80,
  offsetLeft: 40, wallWidth: 320, mounting: "ceiling",
  treatments: [
    { id: "00000000-0000-4000-8000-000000000012", layer: 1, type: "sheer", kind: "curtain", panelLayout: "pair", product: { code: "VOAL-IV", name: "Voal", color: "Ivory" }, width: 300, height: 250 },
    { id: "00000000-0000-4000-8000-000000000013", layer: 2, type: "drapery", kind: "drapery", panelLayout: "left", product: { code: "", name: null, color: null }, width: null, height: null },
  ],
};
const render = (locale: Locale, value: SceneOpening | null, revision: number | null = 7) =>
  renderToStaticMarkup(<I18nProvider locale={locale}><ElevationPreview opening={value} revision={revision} /></I18nProvider>);

test("the 2D sketch names each treatment's product, the stored position and the project revision", () => {
  const markup = render("ro", opening), shown = text(markup);
  assert.match(markup, /<svg/);
  assert.match(shown, /Poziție: Perete 2 · Distanță de la stânga \(cm\): 40 · Lățime perete \(cm\): 320/);
  assert.match(shown, /Perdea · VOAL-IV · Ivory · 300 × 250 cm/);
  assert.match(shown, /Draperie · fără cod produs/);
  assert.match(shown, /Revizia proiectului 7/);
  assert.match(text(render("tr", opening)), /Konum: Duvar 2 .* Tül · VOAL-IV · Ivory .* Proje revizyonu 7/);
});

test("a missing opening dimension is named and never drawn with an invented size", () => {
  const noHeight = text(render("ro", { ...opening, height: null }));
  assert.match(noHeight, /Lipsesc dimensiunile: Înălțime \(cm\)\. Schița apare după completarea lor\./);
  assert.doesNotMatch(render("ro", { ...opening, height: null }), /<svg/);
  assert.match(noHeight, /Perdea · VOAL-IV/);
  const none = render("tr", { ...opening, width: null, height: null, wallIndex: null, offsetLeft: null, wallWidth: null, treatments: [] }, null);
  assert.match(text(none), /Eksik ölçüler: Genişlik \(cm\), Yükseklik \(cm\)\./);
  assert.doesNotMatch(text(none), /Konum|revizyonu|<svg/);
  // A scene that has not loaded yet shows only the empty frame.
  assert.equal(text(render("ro", null)), "Schiță 2D");
});
