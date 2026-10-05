import { ApiError } from "./errors";

export const ORDER_PERMISSIONS = ["b2b.orders.view", "b2b.orders.create", "b2b.orders.update", "b2b.orders.manage_status"] as const;
export type OrderPermission = typeof ORDER_PERMISSIONS[number];
export type Currency = "RON" | "EUR";
export type CommercialStatus = "draft" | "finalized" | "cancelled";
export type LineInput = {
  id: string | null; productCode: string; productName: string | null; variant: string | null; color: string | null;
  kind: "curtain" | "drapery" | "other"; width: string | null; height: string | null;
  quantity: number; meters: string | null; pricingUnit: "piece" | "meter";
  unitPriceNet: string | null; discountPercent: string; vatPercent: string | null;
  notes: string | null; productionNotes: string | null;
};
export type OrderFields = {
  companyId: string; currencyCode: Currency; contactId: string | null; billingAddressId: string | null; deliveryAddressId: string | null;
  customerReference: string | null; notes: string | null; productionNotes: string | null; lines: LineInput[];
};
export type Totals = { net: string; vat: string; gross: string };
export type LineTotals = Totals & { baseNet: string; discountNet: string };
export type Calculation = { currencyCode: Currency; lines: { totals: LineTotals | null }[]; totals: Totals | null; complete: boolean };
export type OrderCapabilities = { canView: boolean; canCreate: boolean; canUpdate: boolean; canFinalize: boolean; canCancel: boolean };
type Actor = { id: string; displayName: string };
export type Order = OrderFields & {
  productionSubmitted?: boolean;
  id: string; code: string; status: CommercialStatus; version: number; sourceOrderId: string | null;
  companySnapshot: Record<string, unknown>; contactSnapshot: Record<string, unknown> | null;
  billingAddressSnapshot: Record<string, unknown> | null; deliveryAddressSnapshot: Record<string, unknown> | null;
  createdAt: string; updatedAt: string; finalizedAt: string | null; cancelledAt: string | null;
  createdBy: Actor; updatedBy: Actor; finalizedBy: Actor | null; calculation: Calculation;
};
export type OrderDetail = { order: Order; capabilities: OrderCapabilities };
export type OrderMutation = { orderId: string; detail: OrderDetail | null };
export type OrderListItem = {
  id: string; code: string; companyId: string; companyName: string; currencyCode: Currency; status: CommercialStatus; version: number;
  customerReference: string | null; createdAt: string; updatedAt: string; createdBy: Actor; totals: Totals | null;
};
export type OrderList = { items: OrderListItem[]; nextCursor: string | null; capabilities: OrderCapabilities };
export type OrderQuery = {
  companyId?: string; search?: string; status?: CommercialStatus | "all"; currency?: Currency | "all";
  from?: string; to?: string; limit?: 25 | 50 | 100; cursor?: string | null;
};
const fail = (): never => { throw new ApiError("INVALID_RESPONSE", 502); };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const str = (v: unknown): string => typeof v === "string" ? v : fail();
const nullable = (v: unknown): string | null => v === null ? null : str(v);
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : fail();
const integer = (v: unknown): number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
function choice<T extends string>(v: unknown, choices: readonly T[]): T { return choices.includes(v as T) ? v as T : fail(); }
const currency = (v: unknown) => choice(v, ["RON", "EUR"] as const);
const status = (v: unknown) => choice(v, ["draft", "finalized", "cancelled"] as const);
function decimal(v: unknown, precision: number, fixed = false): string {
  const s = str(v);
  return (fixed ? /^\d+\.\d{2}$/ : new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`)).test(s) ? s : fail();
}
const decimalNull = (v: unknown, p: number) => v === null ? null : decimal(v, p);
function totals(v: unknown, line = false): Totals | LineTotals | null {
  if (v === null) return null;
  const r = obj(v), out = { net: decimal(r.net, 2, true), vat: decimal(r.vat, 2, true), gross: decimal(r.gross, 2, true) };
  return line ? { ...out, baseNet: decimal(r.baseNet, 2, true), discountNet: decimal(r.discountNet, 2, true) } : out;
}
export function mapCalculation(v: unknown): Calculation {
  const r = obj(v), lines = array(r.lines).map(v => ({ totals: totals(obj(v).totals, true) as LineTotals | null }));
  const complete = bool(r.complete), sum = totals(r.totals);
  if ((complete && !(lines.length > 0 && lines.every(l => l.totals !== null))) || complete !== (sum !== null)) fail();
  return { currencyCode: currency(r.currencyCode), lines, totals: sum, complete };
}
export function mapOrderCapabilities(v: unknown): OrderCapabilities {
  const r = obj(v);
  return { canView: bool(r.canView), canCreate: bool(r.canCreate), canUpdate: bool(r.canUpdate), canFinalize: bool(r.canFinalize), canCancel: bool(r.canCancel) };
}
function mapLine(v: unknown): LineInput {
  const r = obj(v);
  return {
    id: str(r.id), productCode: str(r.productCode), productName: nullable(r.productName), variant: nullable(r.variant), color: nullable(r.color),
    kind: choice(r.kind, ["curtain", "drapery", "other"] as const), width: decimalNull(r.width, 3), height: decimalNull(r.height, 3),
    quantity: integer(r.quantity), meters: decimalNull(r.meters, 3), pricingUnit: choice(r.pricingUnit, ["piece", "meter"] as const),
    unitPriceNet: decimalNull(r.unitPriceNet, 2), discountPercent: decimal(r.discountPercent, 2), vatPercent: decimalNull(r.vatPercent, 2),
    notes: nullable(r.notes), productionNotes: nullable(r.productionNotes),
  };
}
const actor = (v: unknown): Actor => { const r = obj(v); return { id: str(r.id), displayName: str(r.displayName) }; };
const snapshot = (v: unknown) => v === null ? null : obj(v);
export function mapOrderDetail(v: unknown): OrderDetail {
  const d = obj(v), r = obj(d.order), lines = array(r.lines).map(mapLine), calculation = mapCalculation(r.calculation);
  if (lines.length !== calculation.lines.length || r.currencyCode !== calculation.currencyCode) fail();
  return { capabilities: mapOrderCapabilities(d.capabilities), order: {
    companyId: str(r.companyId), currencyCode: currency(r.currencyCode), contactId: nullable(r.contactId),
    billingAddressId: nullable(r.billingAddressId), deliveryAddressId: nullable(r.deliveryAddressId),
    customerReference: nullable(r.customerReference), notes: nullable(r.notes), productionNotes: nullable(r.productionNotes), lines,
    id: str(r.id), code: str(r.code), status: status(r.status), version: integer(r.version), sourceOrderId: nullable(r.sourceOrderId),
    productionSubmitted: r.productionSubmitted === undefined ? false : bool(r.productionSubmitted),
    companySnapshot: obj(r.companySnapshot), contactSnapshot: snapshot(r.contactSnapshot),
    billingAddressSnapshot: snapshot(r.billingAddressSnapshot), deliveryAddressSnapshot: snapshot(r.deliveryAddressSnapshot),
    createdAt: str(r.createdAt), updatedAt: str(r.updatedAt), finalizedAt: nullable(r.finalizedAt), cancelledAt: nullable(r.cancelledAt),
    createdBy: actor(r.createdBy), updatedBy: actor(r.updatedBy), finalizedBy: r.finalizedBy === null ? null : actor(r.finalizedBy), calculation,
  } };
}
export function mapOrderMutation(v: unknown): OrderMutation {
  const r = obj(v); return { orderId: str(r.orderId), detail: r.detail === null ? null : mapOrderDetail(r.detail) };
}
export function mapOrderList(v: unknown): OrderList {
  const r = obj(v);
  return { items: array(r.items).map(v => { const i = obj(v); return {
    id: str(i.id), code: str(i.code), companyId: str(i.companyId), companyName: str(i.companyName), currencyCode: currency(i.currencyCode),
    status: status(i.status), version: integer(i.version), customerReference: nullable(i.customerReference),
    createdAt: str(i.createdAt), updatedAt: str(i.updatedAt), createdBy: actor(i.createdBy), totals: totals(i.totals),
  }; }), nextCursor: nullable(r.nextCursor), capabilities: mapOrderCapabilities(r.capabilities) };
}
