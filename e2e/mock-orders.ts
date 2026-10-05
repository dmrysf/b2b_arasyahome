import { randomUUID } from "node:crypto";
import type { Calculation, Order, OrderFields } from "../src/api/orders";
import type { createCompanyStore, Reply } from "./mock-companies";

const actor = { id: "11111111-1111-4111-8111-111111111111", displayName: "Elena Vânzări" };
const fail = (status: number, code: string): Reply => ({ status, body: { error: { code, message: "English server text", requestId: "r" } } });
const scaled = (value: string, precision: number) => {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("decimal");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > precision) throw new Error("precision");
  return BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, "0"));
};
const round = (value: bigint, denominator: bigint) => (value + denominator / 2n) / denominator;
const money = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;

/** Fixed-point server double; real database tests independently exercise the PHP implementation. */
export function calculate(fields: Pick<OrderFields, "currencyCode" | "lines">): Calculation {
  const lines = fields.lines.map(line => {
    if (!line.productCode || line.unitPriceNet === null || line.vatPercent === null || (line.pricingUnit === "meter" && !line.meters)) return { totals: null };
    const amount = line.pricingUnit === "meter" ? scaled(line.meters!, 3) : BigInt(line.quantity) * 1000n;
    const base = round(amount * scaled(line.unitPriceNet, 2), 1000n);
    const discount = round(base * scaled(line.discountPercent, 2), 10000n), net = base - discount;
    const vat = round(net * scaled(line.vatPercent, 2), 10000n);
    return { totals: { baseNet: money(base), discountNet: money(discount), net: money(net), vat: money(vat), gross: money(net + vat) } };
  });
  const complete = lines.length > 0 && lines.every(line => line.totals !== null);
  const sum = (key: "net" | "vat" | "gross") => money(lines.reduce((sum, line) => sum + scaled(line.totals![key], 2), 0n));
  return { currencyCode: fields.currencyCode, lines, complete, totals: complete ? { net: sum("net"), vat: sum("vat"), gross: sum("gross") } : null };
}

export function createOrderStore(permissions: string[], companies: ReturnType<typeof createCompanyStore>) {
  const orders: Order[] = [], events = new Map<string, unknown[]>();
  const keys = new Map<string, { hash: string; id: string; status: number }>();
  let sequence = 0;
  const can = (p: string) => permissions.includes(`b2b.orders.${p}`);
  const capabilities = () => ({ canView: can("view"), canCreate: can("create"), canUpdate: can("update"), canFinalize: can("manage_status"), canCancel: can("manage_status") });
  const detail = (order: Order) => ({ order, capabilities: capabilities() });
  const answer = (order: Order, status = 200): Reply => ({ status, body: { orderId: order.id, detail: can("view") ? detail(order) : null } });
  const event = (order: Order, action: string) => {
    const list = events.get(order.id) ?? [];
    list.unshift({ id: randomUUID(), action, actor, subject: { type: "order", id: order.id, name: order.code, addressType: null, label: null, city: null }, changedFields: ["lines"], requestId: "r", occurredAt: new Date().toISOString() });
    events.set(order.id, list);
  };
  const snapshot = (id: string) => {
    const company = companies.companies.find(c => c.id === id);
    if (!company || company.status !== "active") return null;
    return Object.fromEntries(["id", "code", "legalName", "displayName", "countryCode", "taxIdentifier", "vatNumber", "registrationNumber"].map(key => [key, company[key]]));
  };
  const seed = (fields: OrderFields, sourceOrderId: string | null = null) => {
    const at = new Date().toISOString();
    const order: Order = { ...structuredClone(fields), lines: fields.lines.map(line => ({ ...line, id: line.id ?? randomUUID() })), id: randomUUID(),
      code: `B2B-ORD-${String(++sequence).padStart(6, "0")}`, status: "draft", version: 1, sourceOrderId, companySnapshot: snapshot(fields.companyId)!,
      contactSnapshot: null, billingAddressSnapshot: null, deliveryAddressSnapshot: null,
      createdAt: at, updatedAt: at, finalizedAt: null, cancelledAt: null, createdBy: actor, updatedBy: actor, finalizedBy: null, calculation: calculate(fields), origin: null };
    orders.unshift(order); event(order, sourceOrderId ? "order_duplicated" : "order_created"); return order;
  };
  const handle = (method: string, path: string, query: URLSearchParams, body: Record<string, unknown>, key?: string): Reply => {
    const tail = path.slice("/b2b/orders".length).split("/").filter(Boolean), [id, action] = tail;
    const mutating = method !== "GET";
    const permission = method === "GET" ? "view" : !id || action === "duplicate" ? "create" : action === "finalize" || action === "cancel" ? "manage_status" : "update";
    if (id === "calculate") {
      if (!can("create") && !can("update")) return fail(403, "FORBIDDEN");
      try { return { status: 200, body: calculate(body as Pick<OrderFields, "currencyCode" | "lines">) }; }
      catch { return fail(422, "VALIDATION_FAILED"); }
    }
    if (!can(permission)) return fail(403, "FORBIDDEN");
    const hash = JSON.stringify([method, path, body]), replay = key ? keys.get(key) : undefined;
    if (mutating && replay) return replay.hash === hash ? answer(orders.find(o => o.id === replay.id)!, replay.status) : fail(409, "IDEMPOTENCY_KEY_REUSED");
    if (method === "GET" && !id) {
      const search = (query.get("search") ?? "").toLowerCase();
      const filtered = orders.filter(o => (!query.get("companyId") || o.companyId === query.get("companyId")) &&
        (!query.get("status") || o.status === query.get("status")) && (!query.get("currency") || o.currencyCode === query.get("currency")) &&
        (!query.get("from") || o.createdAt.slice(0, 10) >= query.get("from")!) && (!query.get("to") || o.createdAt.slice(0, 10) <= query.get("to")!) &&
        (!search || [o.code, String(o.companySnapshot.legalName), o.customerReference ?? "", ...o.lines.map(l => l.productCode)].some(v => v.toLowerCase().includes(search))));
      const start = Number(query.get("cursor") ?? 0), limit = Number(query.get("limit") ?? 25);
      return { status: 200, body: { items: filtered.slice(start, start + limit).map(o => ({ id: o.id, code: o.code, companyId: o.companyId,
        companyName: o.companySnapshot.legalName, currencyCode: o.currencyCode, status: o.status, version: o.version, createdAt: o.createdAt, updatedAt: o.updatedAt,
        createdBy: o.createdBy, customerReference: o.customerReference, totals: o.calculation.totals })), nextCursor: filtered.length > start + limit ? String(start + limit) : null, capabilities: capabilities() } };
    }
    let order = orders.find(o => o.id === id);
    if (method === "GET") {
      if (!order) return fail(404, "ORDER_NOT_FOUND");
      return action === "activity" ? { status: 200, body: { items: events.get(id), nextCursor: null } } : { status: 200, body: detail(order) };
    }
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED");
    let status = 200;
    if (!id) {
      const fields = body as OrderFields;
      if (!snapshot(fields.companyId)) return fail(422, "COMPANY_INACTIVE");
      order = seed(fields); status = 201;
    } else {
      if (!order) return fail(404, "ORDER_NOT_FOUND");
      if (body.expectedVersion !== order.version) return fail(409, "ORDER_CHANGED");
      if (action === "duplicate") {
        if (!snapshot(order.companyId)) return fail(422, "COMPANY_INACTIVE");
        order = seed({ ...order, lines: order.lines.map(l => ({ ...l, id: randomUUID() })) }, order.id); status = 201;
      } else {
        if (order.status === "cancelled") return fail(409, "ORDER_CANCELLED");
        if (order.status === "finalized" && action !== "cancel") return fail(409, "ORDER_FINALIZED");
        if (action === "finalize") {
          if (!order.calculation.complete) return fail(422, "VALIDATION_FAILED");
          order.status = "finalized"; order.finalizedAt = new Date().toISOString(); order.finalizedBy = actor;
          order.companySnapshot = snapshot(order.companyId)!;
          // Like the server, freeze the selected contact and addresses with the fields the API returns.
          const pick = (list: Record<string, unknown>[] | undefined, id: string | null, keys: string[]) => {
            const record = list?.find(item => item.id === id && item.status === "active");
            return record ? Object.fromEntries(["id", ...keys].map(key => [key, record[key] ?? null])) : null;
          };
          const addressKeys = ["type", "label", "countryCode", "countyRegion", "city", "postalCode", "addressLine1", "addressLine2"];
          order.contactSnapshot = pick(companies.contacts.get(order.companyId), order.contactId, ["name", "jobTitle", "email", "phone"]);
          order.billingAddressSnapshot = pick(companies.addresses.get(order.companyId), order.billingAddressId, addressKeys);
          order.deliveryAddressSnapshot = pick(companies.addresses.get(order.companyId), order.deliveryAddressId, addressKeys);
        } else if (action === "cancel") { order.status = "cancelled"; order.cancelledAt = new Date().toISOString(); }
        else if (method === "PUT" && !action) {
          const fields = body as OrderFields;
          if (fields.currencyCode !== order.currencyCode && [...order.lines, ...fields.lines].some(l => l.unitPriceNet !== null)) return fail(409, "CURRENCY_CHANGE_REQUIRES_EMPTY_PRICING");
          Object.assign(order, structuredClone(fields), { calculation: calculate(fields) });
        } else return fail(404, "NOT_FOUND");
        order.version += 1; order.updatedAt = new Date().toISOString();
        event(order, action === "finalize" ? "order_finalized" : action === "cancel" ? "order_cancelled" : "order_updated");
      }
    }
    keys.set(key, { hash, id: order.id, status });
    return answer(order, status);
  };
  const externalEdit = (id: string, patch: Partial<Order>) => { const order = orders.find(o => o.id === id)!; Object.assign(order, patch); order.version += 1; };
  return { handle, seed, orders, externalEdit };
}
