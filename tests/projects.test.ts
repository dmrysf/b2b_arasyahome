import assert from "node:assert/strict";
import { test } from "node:test";
import { mapChangeResult, mapProjectDetail, mapScene } from "../src/api/projects";
import { ApiError } from "../src/api/errors";
import { batches, copyNames, emptyForm, fromForm, projectsRoute, retryDelay, sameForm, scaffold, toForm, updateOps, type PendingEdit } from "../src/projects/model";

test("project routes: list, create and a workspace with an optional room", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(projectsRoute("/proiecte"), { kind: "list" });
  assert.deepEqual(projectsRoute("/proiecte/nou"), { kind: "create" });
  assert.deepEqual(projectsRoute(`/proiecte/${id}?camera=${id}`), { kind: "detail", id, roomId: id });
  assert.deepEqual(projectsRoute(`/proiecte/${id}?camera=x`), { kind: "detail", id, roomId: null });
  assert.equal(projectsRoute("/proiecte/not-a-uuid"), null);
});

test("forms keep the Classic line language: decimal strings, commas accepted, total meters never multiplied", () => {
  const form = toForm("treatment", { treatmentType: "blackout", panelLayout: "pair", productCode: "BLK", productName: null, variant: null, color: "Gri",
    width: "180.000", height: "250.000", quantity: 4, meters: "13.500", pricingUnit: "meter", unitPriceNet: "45.00", discountPercent: "0.00", vatPercent: "19.00", notes: null, productionNotes: null });
  assert.equal(form.meters, "13.5"); assert.equal(form.quantity, "4"); assert.equal(form.unitPriceNet, "45");
  const fields = fromForm("treatment", { ...form, meters: "13,5", width: "" });
  assert.equal(fields.meters, "13.5"); assert.equal(fields.quantity, 4); assert.equal(fields.width, null); assert.equal(fields.discountPercent, "0");
  assert.equal(fields.productCode, "BLK"); assert.equal(fields.productName, null);
  assert.ok(sameForm(toForm("room", { name: "A", widthCm: "100.000", lengthCm: null, ceilingHeightCm: null, notes: null }), { name: "A", widthCm: "100", lengthCm: "", ceilingHeightCm: "", notes: "" }));
  assert.equal(emptyForm("treatment").pricingUnit, "meter");
});

test("pending edits become version-checked update operations", () => {
  const pending = new Map<string, PendingEdit>([["r1", { level: "room", version: 3, form: { name: "Camera 101", widthCm: "420", lengthCm: "", ceilingHeightCm: "", notes: "" } }]]);
  assert.deepEqual(updateOps(pending), [{ op: "room.update", id: "r1", expectedVersion: 3, fields: { name: "Camera 101", widthCm: "420", lengthCm: null, ceilingHeightCm: null, notes: null } }]);
});

test("repetition names: hotel numbering, padding, explicit start, bounded count", () => {
  assert.deepEqual(copyNames("Camera 101", 3), ["Camera 102", "Camera 103", "Camera 104"]);
  assert.deepEqual(copyNames("A-09", 2), ["A-10", "A-11"]);
  assert.deepEqual(copyNames("Living", 2), ["Living 2", "Living 3"]);
  assert.deepEqual(copyNames("Camera 101", 2, 201), ["Camera 201", "Camera 202"]);
  assert.equal(copyNames("X 1", 999).length, 200);
  assert.deepEqual(copyNames("Fereastra 1", 4, undefined, 1, ["Fereastra 1", "Fereastra 2"]), ["Fereastra 3", "Fereastra 4", "Fereastra 5", "Fereastra 6"], "never reuses a name already in the room");
  assert.deepEqual(copyNames("Camera 101", 2, 104, 1, ["camera 105"]), ["Camera 104", "Camera 106"]);
});

test("scaffold builds floors, numbered rooms and empty windows in request-sized batches", () => {
  let n = 0;
  const ops = scaffold({ floors: 5, firstLevel: 1, roomsPerFloor: 20, roomPrefix: "Camera ", windowsPerRoom: 2, floorLabel: "Etaj", windowLabel: "Fereastra" },
    () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
  assert.equal(ops.filter(o => o.op === "zone.create").length, 5);
  const rooms = ops.filter(o => o.op === "room.create");
  assert.equal(rooms.length, 100); assert.equal(ops.filter(o => o.op === "opening.create").length, 200);
  assert.equal(rooms[0].op === "room.create" && rooms[0].fields.name, "Camera 101");
  assert.equal(rooms[99].op === "room.create" && rooms[99].fields.name, "Camera 520");
  assert.deepEqual(batches(ops).map(b => b.length), [305]);
  assert.deepEqual(batches(Array.from({ length: 900 })).map(b => b.length), [400, 400, 100]);
});

test("autosave retries back off without a request storm", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(retryDelay), [2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test("project responses are mapped strictly; empty PHP maps are accepted; renderer data has no engine state", () => {
  assert.deepEqual(mapChangeResult({ projectId: "p", revision: 2, versions: [], created: [] }), { projectId: "p", revision: 2, versions: {}, created: {} });
  assert.deepEqual(mapChangeResult({ projectId: "p", revision: 3, versions: { a: 2 }, created: { 0: ["b"] } }).created, { 0: ["b"] });
  assert.deepEqual(mapChangeResult({ projectId: "p", revision: 3, versions: { a: 2 }, created: [["b"]] }).created, { 0: ["b"] }, "an older replay shape still maps");
  assert.throws(() => mapChangeResult({ projectId: "p", revision: 3, versions: { a: "2" }, created: {} }), ApiError);
  assert.throws(() => mapScene({ schema: "three.js", unit: "cm", projectId: "p", revision: 1, rooms: [] }), ApiError);
  const scene = mapScene({ schema: "arasya.scene/1", unit: "cm", projectId: "p", revision: 1, rooms: [{ id: "r", name: "Camera", dimensions: { width: 420, length: null, ceilingHeight: 280 },
    openings: [{ id: "o", name: "F1", type: "window", wallIndex: 1, width: 160, height: 240, sillHeight: 40, offsetLeft: null, wallWidth: null, mounting: "ceiling", railType: null,
      treatments: [{ id: "t", layer: 1, type: "sheer", kind: "curtain", panelLayout: "pair", product: { code: "V", name: null, variant: null, color: null }, width: 180, height: 250 }] }] }] });
  assert.equal(scene.rooms[0].openings[0].treatments[0].layer, 1);
  const header = { id: "p", code: "B2B-PRJ-000001", name: "Hotel", propertyType: "hotel", status: "draft", currencyCode: "RON", siteAddress: null, customerReference: null, notes: null,
    company: { id: "c", code: "B2B-000001", legalName: "Client", status: "active" }, version: 1, revision: 1, createdAt: "x", updatedAt: "x", archivedAt: null,
    createdBy: { id: "e", displayName: "E" }, updatedBy: { id: "e", displayName: "E" }, counts: { zones: 0, rooms: 0, openings: 0, treatments: 0, orderedTreatments: 0 } };
  const caps = { canView: true, canCreate: true, canUpdate: true, canArchive: false, canConvert: false };
  assert.equal(mapProjectDetail({ project: header, zones: [], capabilities: caps }).project.code, "B2B-PRJ-000001");
  assert.throws(() => mapProjectDetail({ project: { ...header, propertyType: "castle" }, zones: [], capabilities: caps }), ApiError);
});
