import { ApiError } from "./errors";
import type { Currency, LineTotals, Totals } from "./orders";

export const PROJECT_PERMISSIONS = ["b2b.projects.view", "b2b.projects.create", "b2b.projects.update", "b2b.projects.archive", "b2b.projects.convert"] as const;
export type ProjectPermission = typeof PROJECT_PERMISSIONS[number];
export const PROPERTY_TYPES = ["apartment", "house", "hotel", "hospital", "restaurant", "office", "commercial", "other"] as const;
export type PropertyType = typeof PROPERTY_TYPES[number];
export type ProjectStatus = "draft" | "active" | "archived";
export const OPENING_TYPES = ["window", "door", "balcony_door", "wall", "other"] as const;
export const MOUNTINGS = ["ceiling", "wall", "recess"] as const;
export const TREATMENT_TYPES = ["sheer", "drapery", "blackout", "rail", "accessory", "other"] as const;
export const PANEL_LAYOUTS = ["single", "pair", "left", "right"] as const;
export type TreatmentType = typeof TREATMENT_TYPES[number];
export type ProjectCapabilities = { canView: boolean; canCreate: boolean; canUpdate: boolean; canArchive: boolean; canConvert: boolean };
type Actor = { id: string; displayName: string };

export type ZoneFields = { name: string; zoneType: "floor" | "zone"; level: number | null; building: string | null; notes: string | null };
export type RoomFields = { name: string; widthCm: string | null; lengthCm: string | null; ceilingHeightCm: string | null; notes: string | null };
export type OpeningFields = {
  name: string; openingType: typeof OPENING_TYPES[number]; wallIndex: number | null; width: string | null; height: string | null; sillHeight: string | null;
  offsetLeft: string | null; wallWidth: string | null; mounting: typeof MOUNTINGS[number] | null; railType: string | null; notes: string | null;
};
/** Treatment commercial fields use the Classic order line language (same names, decimal strings and meaning). */
export type TreatmentFields = {
  treatmentType: TreatmentType; panelLayout: typeof PANEL_LAYOUTS[number] | null; productCode: string; productName: string | null; variant: string | null; color: string | null;
  width: string | null; height: string | null; quantity: number; meters: string | null; pricingUnit: "piece" | "meter"; unitPriceNet: string | null;
  discountPercent: string; vatPercent: string | null; notes: string | null; productionNotes: string | null;
};
type Node = { id: string; position: number; version: number; copiedFromId: string | null };
export type OrderedRef = { orderId: string; orderCode: string; status: "draft" | "finalized"; lineId: string };
export type Treatment = Node & TreatmentFields & { openingId: string; kind: "curtain" | "drapery" | "other"; totals: LineTotals | null; ordered: OrderedRef | null };
export type Opening = Node & OpeningFields & { roomId: string; treatments: Treatment[] };
export type RoomSummary = Node & RoomFields & { zoneId: string; openingCount: number; treatmentCount: number; orderedCount: number };
export type Room = Node & RoomFields & { zoneId: string; openings: Opening[] };
export type Zone = Node & ZoneFields & { rooms: RoomSummary[] };
export type ProjectHeader = {
  id: string; code: string; name: string; propertyType: PropertyType; status: ProjectStatus; currencyCode: Currency; siteAddress: string | null;
  customerReference: string | null; notes: string | null; company: { id: string; code: string; legalName: string; status: string };
  version: number; revision: number; createdAt: string; updatedAt: string; archivedAt: string | null; createdBy: Actor; updatedBy: Actor;
};
export type ProjectCounts = { zones: number; rooms: number; openings: number; treatments: number; orderedTreatments: number };
export type ProjectDetail = { project: ProjectHeader & { counts: ProjectCounts }; zones: Zone[]; capabilities: ProjectCapabilities };
export type RoomDetail = { revision: number; currencyCode: Currency; status: ProjectStatus; room: Room };
export type ProjectListItem = {
  id: string; code: string; name: string; propertyType: PropertyType; status: ProjectStatus; currencyCode: Currency;
  company: { id: string; code: string; legalName: string }; customerReference: string | null; roomCount: number; openingCount: number;
  version: number; revision: number; updatedAt: string; updatedBy: Actor;
};
export type ProjectList = { items: ProjectListItem[]; nextCursor: string | null; capabilities: ProjectCapabilities };
export type ProjectFields = { companyId: string; name: string; propertyType: PropertyType; currencyCode: Currency; siteAddress: string | null; customerReference: string | null; notes: string | null };
export type Projection = { totals: Totals | null; complete: boolean; treatmentCount: number };
export type Commercial = Projection & { currencyCode: Currency; revision: number; zones: (Projection & { id: string; name: string; rooms: (Projection & { id: string; name: string })[] })[];
  treatments: { id: string; roomId: string; openingId: string; ordered: OrderedRef | null }[] };
export type ChangeResult = { projectId: string; revision: number; versions: Record<string, number>; created: Record<string, string[]> };
export type ProjectOrder = { orderId: string; code: string; status: "draft" | "finalized" | "cancelled"; currencyCode: Currency; totals: Totals | null; lineCount: number; productionSubmitted: boolean; createdAt: string; createdBy: Actor };
/** Renderer-neutral scene document (arasya.scene/1): centimetres and structure only, derived from authoritative data. */
export type Scene = {
  schema: "arasya.scene/1"; unit: "cm"; projectId: string; revision: number;
  rooms: { id: string; name: string; dimensions: { width: number | null; length: number | null; ceilingHeight: number | null };
    openings: { id: string; name: string; type: string; wallIndex: number | null; width: number | null; height: number | null; sillHeight: number | null;
      offsetLeft: number | null; wallWidth: number | null; mounting: string | null;
      treatments: { id: string; layer: number; type: TreatmentType; kind: string; panelLayout: string | null; product: { code: string; name: string | null; color: string | null }; width: number | null; height: number | null }[] }[] }[];
};
export type ProjectActivity = { id: string; action: string; subject: { type: string; id: string }; actor: Actor; occurredAt: string; details: Record<string, unknown> };

const fail = (): never => { throw new ApiError("INVALID_RESPONSE", 502); };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : fail();
const str = (v: unknown): string => typeof v === "string" ? v : fail();
const nstr = (v: unknown): string | null => v === null ? null : str(v);
const int = (v: unknown): number => typeof v === "number" && Number.isSafeInteger(v) ? v : fail();
const nint = (v: unknown): number | null => v === null ? null : int(v);
const num = (v: unknown): number | null => v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
function choice<T extends string>(v: unknown, choices: readonly T[]): T { return choices.includes(v as T) ? v as T : fail(); }
const dec = (v: unknown, scale: number): string | null => v === null ? null : new RegExp(`^\\d+\\.\\d{${scale}}$`).test(str(v)) ? v as string : fail();
const money = (v: unknown) => dec(v, 2) ?? fail();
const actor = (v: unknown): Actor => { const r = obj(v); return { id: str(r.id), displayName: str(r.displayName) }; };
/** Empty JSON maps may arrive as [] (PHP); both mean "no entries". */
const map = (v: unknown): Record<string, unknown> => Array.isArray(v) && v.length === 0 ? {} : obj(v);
function totals(v: unknown): Totals | null { if (v === null) return null; const r = obj(v); return { net: money(r.net), vat: money(r.vat), gross: money(r.gross) }; }
function lineTotals(v: unknown): LineTotals | null {
  if (v === null || v === undefined) return null;
  const r = obj(v); return { baseNet: money(r.baseNet), discountNet: money(r.discountNet), net: money(r.net), vat: money(r.vat), gross: money(r.gross) };
}
const node = (r: Record<string, unknown>) => ({ id: str(r.id), position: int(r.position), version: int(r.version), copiedFromId: nstr(r.copiedFromId) });

export function mapCapabilities(v: unknown): ProjectCapabilities {
  const r = obj(v); return { canView: bool(r.canView), canCreate: bool(r.canCreate), canUpdate: bool(r.canUpdate), canArchive: bool(r.canArchive), canConvert: bool(r.canConvert) };
}
function zoneFields(r: Record<string, unknown>): ZoneFields {
  return { name: str(r.name), zoneType: choice(r.zoneType, ["floor", "zone"] as const), level: nint(r.level), building: nstr(r.building), notes: nstr(r.notes) };
}
function roomFields(r: Record<string, unknown>): RoomFields {
  return { name: str(r.name), widthCm: dec(r.widthCm, 3), lengthCm: dec(r.lengthCm, 3), ceilingHeightCm: dec(r.ceilingHeightCm, 3), notes: nstr(r.notes) };
}
export function mapTreatment(v: unknown): Treatment {
  const r = obj(v), ordered = r.ordered === null || r.ordered === undefined ? null : obj(r.ordered);
  return { ...node(r), openingId: str(r.openingId), treatmentType: choice(r.treatmentType, TREATMENT_TYPES), panelLayout: r.panelLayout === null ? null : choice(r.panelLayout, PANEL_LAYOUTS),
    productCode: str(r.productCode), productName: nstr(r.productName), variant: nstr(r.variant), color: nstr(r.color), width: dec(r.width, 3), height: dec(r.height, 3),
    quantity: int(r.quantity), meters: dec(r.meters, 3), pricingUnit: choice(r.pricingUnit, ["piece", "meter"] as const), unitPriceNet: dec(r.unitPriceNet, 2),
    discountPercent: money(r.discountPercent), vatPercent: dec(r.vatPercent, 2), notes: nstr(r.notes), productionNotes: nstr(r.productionNotes),
    kind: choice(r.kind, ["curtain", "drapery", "other"] as const), totals: lineTotals(r.totals),
    ordered: ordered && { orderId: str(ordered.orderId), orderCode: str(ordered.orderCode), status: choice(ordered.status, ["draft", "finalized"] as const), lineId: str(ordered.lineId) } };
}
function mapOpening(v: unknown): Opening {
  const r = obj(v);
  return { ...node(r), roomId: str(r.roomId), name: str(r.name), openingType: choice(r.openingType, OPENING_TYPES), wallIndex: nint(r.wallIndex), width: dec(r.width, 3),
    height: dec(r.height, 3), sillHeight: dec(r.sillHeight, 3), offsetLeft: dec(r.offsetLeft, 3), wallWidth: dec(r.wallWidth, 3),
    mounting: r.mounting === null ? null : choice(r.mounting, MOUNTINGS), railType: nstr(r.railType), notes: nstr(r.notes), treatments: arr(r.treatments).map(mapTreatment) };
}
function header(v: unknown): ProjectHeader {
  const r = obj(v), c = obj(r.company);
  return { id: str(r.id), code: str(r.code), name: str(r.name), propertyType: choice(r.propertyType, PROPERTY_TYPES), status: choice(r.status, ["draft", "active", "archived"] as const),
    currencyCode: choice(r.currencyCode, ["RON", "EUR"] as const), siteAddress: nstr(r.siteAddress), customerReference: nstr(r.customerReference), notes: nstr(r.notes),
    company: { id: str(c.id), code: str(c.code), legalName: str(c.legalName), status: str(c.status) }, version: int(r.version), revision: int(r.revision),
    createdAt: str(r.createdAt), updatedAt: str(r.updatedAt), archivedAt: nstr(r.archivedAt), createdBy: actor(r.createdBy), updatedBy: actor(r.updatedBy) };
}
export function mapProjectDetail(v: unknown): ProjectDetail {
  const d = obj(v), p = obj(d.project), c = obj(p.counts);
  return {
    project: { ...header(p), counts: { zones: int(c.zones), rooms: int(c.rooms), openings: int(c.openings), treatments: int(c.treatments), orderedTreatments: int(c.orderedTreatments) } },
    zones: arr(d.zones).map(z => { const r = obj(z); return { ...node(r), ...zoneFields(r), rooms: arr(r.rooms).map(x => { const q = obj(x);
      return { ...node(q), ...roomFields(q), zoneId: str(q.zoneId), openingCount: int(q.openingCount), treatmentCount: int(q.treatmentCount), orderedCount: int(q.orderedCount) }; }) }; }),
    capabilities: mapCapabilities(d.capabilities),
  };
}
export function mapRoomDetail(v: unknown): RoomDetail {
  const d = obj(v), r = obj(d.room);
  return { revision: int(d.revision), currencyCode: choice(d.currencyCode, ["RON", "EUR"] as const), status: choice(d.status, ["draft", "active", "archived"] as const),
    room: { ...node(r), ...roomFields(r), zoneId: str(r.zoneId), openings: arr(r.openings).map(mapOpening) } };
}
export function mapProjectList(v: unknown): ProjectList {
  const d = obj(v);
  return { items: arr(d.items).map(x => { const r = obj(x), c = obj(r.company); return {
    id: str(r.id), code: str(r.code), name: str(r.name), propertyType: choice(r.propertyType, PROPERTY_TYPES), status: choice(r.status, ["draft", "active", "archived"] as const),
    currencyCode: choice(r.currencyCode, ["RON", "EUR"] as const), company: { id: str(c.id), code: str(c.code), legalName: str(c.legalName) },
    customerReference: nstr(r.customerReference), roomCount: int(r.roomCount), openingCount: int(r.openingCount), version: int(r.version), revision: int(r.revision),
    updatedAt: str(r.updatedAt), updatedBy: actor(r.updatedBy) }; }), nextCursor: nstr(d.nextCursor), capabilities: mapCapabilities(d.capabilities) };
}
export function mapProjectMutation(v: unknown): { projectId: string; detail: ProjectDetail | null } {
  const r = obj(v); return { projectId: str(r.projectId), detail: r.detail === undefined ? null : mapProjectDetail(r.detail) };
}
export function mapChangeResult(v: unknown): ChangeResult {
  const r = obj(v);
  return { projectId: str(r.projectId), revision: int(r.revision),
    versions: Object.fromEntries(Object.entries(map(r.versions)).map(([k, x]) => [k, int(x)])),
    created: Object.fromEntries(Object.entries(map(r.created)).map(([k, x]) => [k, arr(x).map(str)])) };
}
const projection = (r: Record<string, unknown>): Projection => ({ totals: totals(r.totals), complete: bool(r.complete), treatmentCount: int(r.treatmentCount) });
export function mapCommercial(v: unknown): Commercial {
  const r = obj(v);
  return { ...projection(r), currencyCode: choice(r.currencyCode, ["RON", "EUR"] as const), revision: int(r.revision),
    zones: arr(r.zones).map(z => { const q = obj(z); return { ...projection(q), id: str(q.id), name: str(q.name), rooms: arr(q.rooms).map(x => { const w = obj(x); return { ...projection(w), id: str(w.id), name: str(w.name) }; }) }; }),
    treatments: arr(r.treatments).map(x => { const t = obj(x), o = t.ordered === null ? null : obj(t.ordered); return { id: str(t.id), roomId: str(t.roomId), openingId: str(t.openingId),
      ordered: o && { orderId: str(o.orderId), orderCode: str(o.orderCode), status: choice(o.status, ["draft", "finalized"] as const), lineId: str(o.lineId) } }; }) };
}
export function mapProjectOrders(v: unknown): ProjectOrder[] {
  return arr(obj(v).items).map(x => { const r = obj(x); return { orderId: str(r.orderId), code: str(r.code), status: choice(r.status, ["draft", "finalized", "cancelled"] as const),
    currencyCode: choice(r.currencyCode, ["RON", "EUR"] as const), totals: totals(r.totals), lineCount: int(r.lineCount), productionSubmitted: bool(r.productionSubmitted),
    createdAt: str(r.createdAt), createdBy: actor(r.createdBy) }; });
}
export function mapScene(v: unknown): Scene {
  const r = obj(v);
  if (r.schema !== "arasya.scene/1" || r.unit !== "cm") fail();
  return { schema: "arasya.scene/1", unit: "cm", projectId: str(r.projectId), revision: int(r.revision), rooms: arr(r.rooms).map(x => { const room = obj(x), d = obj(room.dimensions); return {
    id: str(room.id), name: str(room.name), dimensions: { width: num(d.width), length: num(d.length), ceilingHeight: num(d.ceilingHeight) },
    openings: arr(room.openings).map(y => { const o = obj(y); return { id: str(o.id), name: str(o.name), type: str(o.type), wallIndex: nint(o.wallIndex), width: num(o.width), height: num(o.height),
      sillHeight: num(o.sillHeight), offsetLeft: num(o.offsetLeft), wallWidth: num(o.wallWidth), mounting: nstr(o.mounting),
      treatments: arr(o.treatments).map(z => { const t = obj(z), p = obj(t.product); return { id: str(t.id), layer: int(t.layer), type: choice(t.type, TREATMENT_TYPES), kind: str(t.kind),
        panelLayout: nstr(t.panelLayout), product: { code: str(p.code), name: nstr(p.name), color: nstr(p.color) }, width: num(t.width), height: num(t.height) }; }) }; }) }; }) };
}
export function mapProjectActivity(v: unknown): { items: ProjectActivity[]; nextCursor: string | null } {
  const r = obj(v);
  return { items: arr(r.items).map(x => { const a = obj(x), s = obj(a.subject); return { id: str(a.id), action: str(a.action), subject: { type: str(s.type), id: str(s.id) },
    actor: actor(a.actor), occurredAt: str(a.occurredAt), details: map(a.details) }; }), nextCursor: nstr(r.nextCursor) };
}

/** One workspace operation of POST /b2b/projects/{id}/changes. */
export type ProjectOperation =
  | { op: "zone.create"; id: string; fields: ZoneFields } | { op: "zone.update"; id: string; expectedVersion: number; fields: ZoneFields }
  | { op: "room.create"; id: string; zoneId: string; fields: RoomFields } | { op: "room.update"; id: string; expectedVersion: number; fields: RoomFields }
  | { op: "opening.create"; id: string; roomId: string; fields: OpeningFields } | { op: "opening.update"; id: string; expectedVersion: number; fields: OpeningFields }
  | { op: "treatment.create"; id: string; openingId: string; fields: TreatmentFields } | { op: "treatment.update"; id: string; expectedVersion: number; fields: TreatmentFields }
  | { op: "zone.remove" | "room.remove" | "opening.remove" | "treatment.remove"; id: string; expectedVersion: number }
  | { op: "room.move"; id: string; expectedVersion: number; zoneId: string }
  | { op: "room.duplicate"; id: string; names: string[]; zoneId?: string }
  | { op: "opening.duplicate"; id: string; names: string[] }
  | { op: "treatment.duplicate"; id: string }
  | { op: "room.apply"; sourceId: string; targetIds: string[]; mode: "append" | "replace" }
  | { op: "treatment.copySet"; sourceOpeningId: string; targetOpeningIds: string[]; mode: "append" | "replace" }
  | { op: "reorder"; level: "zone" | "room" | "opening" | "treatment"; parentId: string | null; ids: string[] };
