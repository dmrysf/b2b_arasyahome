import type { Currency, LineInput, OrderFields } from "../api/orders";
export type LineDraft = Omit<LineInput, "id" | "quantity" | "productName" | "variant" | "color" | "width" | "height" | "meters" | "unitPriceNet" | "vatPercent" | "notes" | "productionNotes"> & {
  id: string; quantity: string; productName: string; variant: string; color: string; width: string; height: string;
  meters: string; unitPriceNet: string; vatPercent: string; notes: string; productionNotes: string;
};
export type OrderDraft = {
  companyId: string; currencyCode: Currency; contactId: string; billingAddressId: string; deliveryAddressId: string;
  customerReference: string; notes: string; productionNotes: string; lines: LineDraft[];
};
export const emptyLine = (): LineDraft => ({
  id: crypto.randomUUID(), productCode: "", productName: "", variant: "", color: "", kind: "curtain", width: "", height: "",
  quantity: "1", meters: "", pricingUnit: "piece", unitPriceNet: "", discountPercent: "0", vatPercent: "", notes: "", productionNotes: "",
});
export const emptyOrder = (companyId = ""): OrderDraft => ({
  companyId, currencyCode: "RON", contactId: "", billingAddressId: "", deliveryAddressId: "", customerReference: "", notes: "", productionNotes: "", lines: [],
});
const nullable = (s: string) => s.trim() || null;
const dec = (s: string) => s.trim().replace(",", ".");
export function orderFields(d: OrderDraft): OrderFields {
  return {
    companyId: d.companyId, currencyCode: d.currencyCode, contactId: nullable(d.contactId),
    billingAddressId: nullable(d.billingAddressId), deliveryAddressId: nullable(d.deliveryAddressId),
    customerReference: nullable(d.customerReference), notes: nullable(d.notes), productionNotes: nullable(d.productionNotes),
    lines: d.lines.map(l => ({
      id: l.id, productCode: l.productCode.trim(), productName: nullable(l.productName), variant: nullable(l.variant), color: nullable(l.color),
      kind: l.kind, width: nullable(dec(l.width)), height: nullable(dec(l.height)), quantity: /^\d+$/.test(l.quantity) ? Number(l.quantity) : 0,
      meters: nullable(dec(l.meters)), pricingUnit: l.pricingUnit, unitPriceNet: nullable(dec(l.unitPriceNet)),
      discountPercent: dec(l.discountPercent) || "0", vatPercent: nullable(dec(l.vatPercent)),
      notes: nullable(l.notes), productionNotes: nullable(l.productionNotes),
    })),
  };
}
export function orderDraft(f: OrderFields): OrderDraft {
  return { ...f, contactId: f.contactId ?? "", billingAddressId: f.billingAddressId ?? "", deliveryAddressId: f.deliveryAddressId ?? "",
    customerReference: f.customerReference ?? "", notes: f.notes ?? "", productionNotes: f.productionNotes ?? "",
    lines: f.lines.map(l => ({ ...l, id: l.id!, quantity: String(l.quantity), productName: l.productName ?? "", variant: l.variant ?? "", color: l.color ?? "",
      width: l.width ?? "", height: l.height ?? "", meters: l.meters ?? "", unitPriceNet: l.unitPriceNet ?? "", vatPercent: l.vatPercent ?? "",
      notes: l.notes ?? "", productionNotes: l.productionNotes ?? "" })),
  };
}
export function currencyLocked(current: LineInput[], saved: LineInput[]): boolean { return [...current, ...saved].some(l => l.unitPriceNet !== null); }
export class LatestCalculation { private generation = 0; begin() { return ++this.generation; } accept(generation: number) { return this.generation === generation; } }
export const orderPath = (id: string) => `/comenzi/${encodeURIComponent(id)}`;
export function ordersRoute(path: string): null | { kind: "list" | "create" } | { kind: "detail"; id: string } {
  const p = path.split("?")[0].replace(/\/+$/, "");
  if (p === "/comenzi") return { kind: "list" };
  if (p === "/comenzi/noua") return { kind: "create" };
  const match = /^\/comenzi\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.exec(p);
  return match ? { kind: "detail", id: match[1] } : null;
}
