import type { OpeningFields, ProjectOperation, RoomFields, TreatmentFields, ZoneFields } from "../api/projects";

export const PROJECTS_PATH = "/proiecte";
export const projectPath = (id: string) => `${PROJECTS_PATH}/${encodeURIComponent(id)}`;
export function projectsRoute(path: string): null | { kind: "list" | "create" } | { kind: "detail"; id: string; roomId: string | null } {
  const [p, query] = path.split("?");
  const clean = p.replace(/\/+$/, "");
  if (clean === PROJECTS_PATH) return { kind: "list" };
  if (clean === `${PROJECTS_PATH}/nou`) return { kind: "create" };
  const match = /^\/proiecte\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.exec(clean);
  if (!match) return null;
  const room = new URLSearchParams(query ?? "").get("camera");
  return { kind: "detail", id: match[1], roomId: room && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(room) ? room : null };
}

export type Level = "zone" | "room" | "opening" | "treatment";
/** Editable text form of a node: every input is a string; conversion to API values happens only when saving. */
export type Form = Record<string, string>;
const FORM_FIELDS: Record<Level, string[]> = {
  zone: ["name", "zoneType", "level", "building", "notes"],
  room: ["name", "widthCm", "lengthCm", "ceilingHeightCm", "notes"],
  opening: ["name", "openingType", "wallIndex", "width", "height", "sillHeight", "offsetLeft", "wallWidth", "mounting", "railType", "notes"],
  treatment: ["treatmentType", "panelLayout", "productCode", "productName", "variant", "color", "width", "height", "quantity", "meters", "pricingUnit", "unitPriceNet",
    "discountPercent", "vatPercent", "notes", "productionNotes"],
};
const DECIMALS = new Set(["widthCm", "lengthCm", "ceilingHeightCm", "width", "height", "sillHeight", "offsetLeft", "wallWidth", "meters", "unitPriceNet", "discountPercent", "vatPercent"]);
const INTEGERS = new Set(["level", "wallIndex", "quantity"]);

/** Server value -> input text. Stored decimals keep their scale; "180.000" is shown as "180". */
export function toForm(level: Level, fields: Record<string, unknown>): Form {
  return Object.fromEntries(FORM_FIELDS[level].map(f => {
    const v = fields[f];
    if (v === null || v === undefined) return [f, ""];
    if (typeof v === "number") return [f, String(v)];
    const text = String(v);
    return [f, DECIMALS.has(f) && /^\d+\.\d+$/.test(text) ? trimDecimal(text) : text];
  }));
}
export function trimDecimal(value: string): string { return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value; }

/** Input text -> API fields. Commas become dots; empty optional values become null; the server validates everything. */
export function fromForm(level: "zone", form: Form): ZoneFields;
export function fromForm(level: "room", form: Form): RoomFields;
export function fromForm(level: "opening", form: Form): OpeningFields;
export function fromForm(level: "treatment", form: Form): TreatmentFields;
export function fromForm(level: Level, form: Form): ZoneFields | RoomFields | OpeningFields | TreatmentFields;
export function fromForm(level: Level, form: Form) {
  const out: Record<string, unknown> = {};
  for (const f of FORM_FIELDS[level]) {
    const raw = (form[f] ?? "").trim();
    if (INTEGERS.has(f)) out[f] = raw === "" ? (f === "quantity" ? 0 : null) : /^-?\d+$/.test(raw) ? Number(raw) : raw;
    else if (DECIMALS.has(f)) out[f] = raw === "" ? (f === "discountPercent" ? "0" : null) : raw.replace(",", ".");
    else if (f === "productCode") out[f] = raw;
    else out[f] = raw === "" ? null : raw;
  }
  return out;
}

export const sameForm = (a: Form, b: Form) => Object.keys(b).every(k => (a[k] ?? "") === (b[k] ?? ""));

export function emptyForm(level: Level, name = ""): Form {
  const base = Object.fromEntries(FORM_FIELDS[level].map(f => [f, ""]));
  if (level === "zone") return { ...base, name, zoneType: "floor" };
  if (level === "opening") return { ...base, name, openingType: "window" };
  if (level === "treatment") return { ...base, treatmentType: "sheer", panelLayout: "pair", quantity: "1", pricingUnit: "meter", discountPercent: "0", vatPercent: "19" };
  return { ...base, name };
}

/** One pending edit of an existing node: the latest form and the version it was based on. */
export type PendingEdit = { level: Level; version: number; form: Form };
export function updateOps(pending: Map<string, PendingEdit>): ProjectOperation[] {
  return [...pending].map(([id, edit]) => ({ op: `${edit.level}.update`, id, expectedVersion: edit.version, fields: fromForm(edit.level, edit.form) }) as ProjectOperation);
}

/** Retry delays after a transport failure: 2, 4, 8, 16, then every 30 seconds. Never a request storm. */
export function retryDelay(attempt: number): number { return Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt - 1)); }
/** Debounce after the last keystroke before an automatic save. */
export const AUTOSAVE_DELAY_MS = 1_500;

/**
 * Names for N copies: "Camera 101" -> "Camera 102", "Camera 103"…; a name without a trailing number gets " 2", " 3"…
 * Zero padding is kept ("A-01" -> "A-02"). The employee can always edit the proposal before applying it.
 */
export function copyNames(source: string, count: number, start?: number, step = 1, taken: Iterable<string> = []): string[] {
  const match = /^(.*?)(\d+)\s*$/.exec(source.trim());
  const prefix = match ? match[1] : `${source.trim()} `;
  const width = match ? match[2].length : 1;
  const used = new Set([...taken].map(name => name.trim().toLocaleLowerCase()));
  const out: string[] = [];
  // Names already used next to the copies are skipped, so no two windows of a room (or rooms of a project) share a label.
  for (let n = start ?? (match ? Number(match[2]) + step : 2), guard = 0; out.length < Math.max(0, Math.min(count, 200)) && guard < 10_000; n += step, guard++) {
    const name = `${prefix}${String(n).padStart(width, "0")}`;
    if (!used.has(name.toLocaleLowerCase())) { out.push(name); used.add(name.toLocaleLowerCase()); }
  }
  return out;
}

/** Hotel-style scaffold: floors x rooms with "101, 102…" numbering and identical windows. */
export function scaffold(input: { floors: number; firstLevel: number; roomsPerFloor: number; roomPrefix: string; windowsPerRoom: number; floorLabel: string; windowLabel: string },
  uuid: () => string = () => crypto.randomUUID()): ProjectOperation[] {
  const ops: ProjectOperation[] = [];
  for (let f = 0; f < input.floors; f++) {
    const level = input.firstLevel + f, zone = uuid();
    ops.push({ op: "zone.create", id: zone, fields: { name: `${input.floorLabel} ${level}`, zoneType: "floor", level, building: null, notes: null } });
    for (let r = 1; r <= input.roomsPerFloor; r++) {
      const room = uuid(), number = input.roomsPerFloor > 99 ? level * 1000 + r : level * 100 + r;
      ops.push({ op: "room.create", id: room, zoneId: zone, fields: { name: `${input.roomPrefix}${level < 0 ? `${level}.${r}` : number}`, widthCm: null, lengthCm: null, ceilingHeightCm: null, notes: null } });
      for (let w = 1; w <= input.windowsPerRoom; w++) ops.push({ op: "opening.create", id: uuid(), roomId: room, fields: {
        name: `${input.windowLabel} ${w}`, openingType: "window", wallIndex: null, width: null, height: null, sillHeight: null, offsetLeft: null, wallWidth: null, mounting: null, railType: null, notes: null } });
    }
  }
  return ops;
}

/** Splits operations into request-sized batches that each stay atomic on the server. */
export function batches<T>(items: T[], size = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Display of a centimetre value: "180.000" -> "180", "180.5" -> "180,5". */
export const cm = (value: string | null | undefined) => value ? trimDecimal(value).replace(".", ",") : "—";
