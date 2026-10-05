import { ApiError } from "./errors";

/**
 * B2B Current Account V1 contract (Operations API 2.10.0). Every amount is a decimal string with two places,
 * produced by the server ledger; the browser never computes an authoritative figure.
 */
export const ACCOUNT_PERMISSIONS = ["b2b.accounts.view", "b2b.accounts.record_payment", "b2b.accounts.adjust", "b2b.accounts.reverse", "b2b.accounts.export"] as const;
export type AccountPermission = (typeof ACCOUNT_PERMISSIONS)[number];

export const ACCOUNT_CURRENCIES = ["RON", "EUR"] as const;
export type AccountCurrency = (typeof ACCOUNT_CURRENCIES)[number];
export const MOVEMENT_TYPES = ["order_receivable", "payment", "opening_balance", "adjustment", "reversal"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export type Direction = "debit" | "credit";
export const PAYMENT_METHODS = ["bank_transfer", "cash", "card", "compensation", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type AccountCapabilities = { canView: boolean; canRecordPayment: boolean; canAdjust: boolean; canReverse: boolean; canExport: boolean };
export type AccountCompany = {
  id: string; code: string; legalName: string; displayName: string | null; countryCode: string; taxIdentifier: string;
  vatNumber: string | null; registrationNumber: string | null; status: "active" | "inactive";
};
export type CurrencySummary = {
  balance: string; debits: string; credits: string; outstandingReceivables: string; unallocatedPayments: string;
  activeOpeningBalance: boolean; movementCount: number;
};
export type AccountSummary = {
  company: AccountCompany; currencies: Record<AccountCurrency, CurrencySummary>;
  capabilities: AccountCapabilities & { companyActive: boolean };
};
export type Movement = {
  id: string; code: string; type: MovementType; direction: Direction; amount: string; currencyCode: AccountCurrency; valueDate: string;
  orderId: string | null; orderCode: string | null; method: PaymentMethod | null; externalReference: string | null; note: string | null;
  reasonCode: string | null; reverses: { id: string; code: string } | null; reversedBy: { id: string; code: string; valueDate: string } | null;
  allocated: string | null; open: string | null; createdAt: string; createdBy: { id: string; displayName: string };
};
export type MovementPage = { items: Movement[]; nextCursor: string | null; capabilities: AccountCapabilities };
export type Allocation = {
  id: string; paymentId: string; paymentCode: string; receivableId: string; receivableCode: string; orderCode: string | null;
  amount: string; currencyCode: AccountCurrency; createdAt: string; createdBy: string;
  released: { kind: "manual" | "payment_reversed" | "receivable_reversed"; reason: string | null; at: string; by: string } | null;
};
export type MovementDetail = { movement: Movement; allocations: Allocation[]; capabilities: AccountCapabilities };
export type OpenItem = { id: string; code: string; valueDate: string; amount: string; openAmount: string; orderCode: string | null; method: PaymentMethod | null; externalReference: string | null };
export type OpenItems = { currencyCode: AccountCurrency; receivables: OpenItem[]; payments: OpenItem[] };
export type StatementRow = {
  id: string; code: string; valueDate: string; type: MovementType; direction: Direction; orderCode: string | null; method: PaymentMethod | null;
  externalReference: string | null; reasonCode: string | null; reversesCode: string | null; reversedByCode: string | null;
  debit: string | null; credit: string | null; runningBalance: string; createdAt: string; createdBy: string;
};
export type Statement = {
  company: AccountCompany; currencyCode: AccountCurrency; from: string | null; to: string; openingBalance: string;
  totals: { debit: string; credit: string }; closingBalance: string; movements: StatementRow[]; generatedAt: string;
};
export type AccountOverviewItem = {
  companyId: string; companyCode: string; legalName: string; displayName: string | null; companyStatus: "active" | "inactive";
  balances: Record<AccountCurrency, string>; movementCount: number; lastValueDate: string | null;
};
export type AccountOverview = { items: AccountOverviewItem[]; nextCursor: string | null; capabilities: AccountCapabilities };
export type AccountActivity = {
  id: string; action: string; movementId: string | null; movementCode: string | null; allocationId: string | null; orderId: string | null;
  currencyCode: AccountCurrency | null; actor: { id: string; displayName: string }; occurredAt: string;
};
export type AccountActivityPage = { items: AccountActivity[]; nextCursor: string | null };
export type AccountMutation = { companyId: string; movementId: string; allocationIds: string[]; summary: AccountSummary | null };

export type AllocationInput = { receivableId: string; amount: string };
export type PaymentInput = {
  currencyCode: AccountCurrency; amount: string; valueDate: string; method: PaymentMethod;
  externalReference: string | null; note: string | null; allocations: AllocationInput[];
};
export type EntryInput = { currencyCode: AccountCurrency; direction: Direction; amount: string; valueDate: string; reason: string };
export type ReversalInput = { valueDate: string; reason: string };
export type MovementQuery = { currency?: AccountCurrency | "all"; type?: MovementType | "all"; from?: string; to?: string; cursor?: string | null; limit?: 25 | 50 | 100 };
export type StatementQuery = { currency: AccountCurrency; from?: string; to?: string };
export type OverviewQuery = { search?: string; status?: "active" | "inactive" | "all"; balance?: "all" | "open"; cursor?: string | null; limit?: 25 | 50 | 100 };

const fail = (): never => { throw new ApiError("INVALID_RESPONSE", 502); };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const str = (v: unknown): string => typeof v === "string" ? v : fail();
const nullable = (v: unknown): string | null => v === null ? null : str(v);
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : fail();
const bool = (v: unknown): boolean => typeof v === "boolean" ? v : fail();
const count = (v: unknown): number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fail();
function choice<T extends string>(v: unknown, choices: readonly T[]): T { return choices.includes(v as T) ? v as T : fail(); }
/** Server money: optional minus, digits, exactly two decimals. Kept as text end to end. */
const money = (v: unknown): string => /^-?\d+\.\d{2}$/.test(str(v)) ? v as string : fail();
const moneyNull = (v: unknown): string | null => v === null ? null : money(v);
const date = (v: unknown): string => /^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? v as string : fail();
const currency = (v: unknown) => choice(v, ACCOUNT_CURRENCIES);
const method = (v: unknown) => v === null ? null : choice(v, PAYMENT_METHODS);
const link = (v: unknown) => { if (v === null) return null; const r = obj(v); return { id: str(r.id), code: str(r.code) }; };

export function mapAccountCapabilities(v: unknown): AccountCapabilities {
  const r = obj(v);
  return { canView: bool(r.canView), canRecordPayment: bool(r.canRecordPayment), canAdjust: bool(r.canAdjust), canReverse: bool(r.canReverse), canExport: bool(r.canExport) };
}
function mapCompany(v: unknown): AccountCompany {
  const r = obj(v);
  return { id: str(r.id), code: str(r.code), legalName: str(r.legalName), displayName: nullable(r.displayName), countryCode: str(r.countryCode),
    taxIdentifier: str(r.taxIdentifier), vatNumber: nullable(r.vatNumber), registrationNumber: nullable(r.registrationNumber), status: choice(r.status, ["active", "inactive"] as const) };
}
export function mapAccountSummary(v: unknown): AccountSummary {
  const r = obj(v), c = obj(r.currencies), caps = obj(r.capabilities);
  const one = (x: unknown): CurrencySummary => { const s = obj(x); return {
    balance: money(s.balance), debits: money(s.debits), credits: money(s.credits), outstandingReceivables: money(s.outstandingReceivables),
    unallocatedPayments: money(s.unallocatedPayments), activeOpeningBalance: bool(s.activeOpeningBalance), movementCount: count(s.movementCount),
  }; };
  return { company: mapCompany(r.company), currencies: { RON: one(c.RON), EUR: one(c.EUR) }, capabilities: { ...mapAccountCapabilities(caps), companyActive: bool(caps.companyActive) } };
}
export function mapMovement(v: unknown): Movement {
  const r = obj(v), by = obj(r.createdBy);
  const reversedBy = r.reversedBy === null ? null : (() => { const x = obj(r.reversedBy); return { id: str(x.id), code: str(x.code), valueDate: date(x.valueDate) }; })();
  return {
    id: str(r.id), code: str(r.code), type: choice(r.type, MOVEMENT_TYPES), direction: choice(r.direction, ["debit", "credit"] as const), amount: money(r.amount),
    currencyCode: currency(r.currencyCode), valueDate: date(r.valueDate), orderId: nullable(r.orderId), orderCode: nullable(r.orderCode), method: method(r.method),
    externalReference: nullable(r.externalReference), note: nullable(r.note), reasonCode: nullable(r.reasonCode), reverses: link(r.reverses), reversedBy,
    allocated: moneyNull(r.allocated), open: moneyNull(r.open), createdAt: str(r.createdAt), createdBy: { id: str(by.id), displayName: str(by.displayName) },
  };
}
export function mapMovementPage(v: unknown): MovementPage {
  const r = obj(v);
  return { items: array(r.items).map(mapMovement), nextCursor: nullable(r.nextCursor), capabilities: mapAccountCapabilities(r.capabilities) };
}
export function mapMovementDetail(v: unknown): MovementDetail {
  const r = obj(v);
  return { movement: mapMovement(r.movement), capabilities: mapAccountCapabilities(r.capabilities), allocations: array(r.allocations).map(x => {
    const a = obj(x);
    const released = a.released === null ? null : (() => { const z = obj(a.released); return {
      kind: choice(z.kind, ["manual", "payment_reversed", "receivable_reversed"] as const), reason: nullable(z.reason), at: str(z.at), by: str(z.by),
    }; })();
    return { id: str(a.id), paymentId: str(a.paymentId), paymentCode: str(a.paymentCode), receivableId: str(a.receivableId), receivableCode: str(a.receivableCode),
      orderCode: nullable(a.orderCode), amount: money(a.amount), currencyCode: currency(a.currencyCode), createdAt: str(a.createdAt), createdBy: str(a.createdBy), released };
  }) };
}
export function mapOpenItems(v: unknown): OpenItems {
  const r = obj(v);
  const item = (x: unknown): OpenItem => { const i = obj(x); return {
    id: str(i.id), code: str(i.code), valueDate: date(i.valueDate), amount: money(i.amount), openAmount: money(i.openAmount),
    orderCode: nullable(i.orderCode), method: method(i.method), externalReference: nullable(i.externalReference),
  }; };
  return { currencyCode: currency(r.currencyCode), receivables: array(r.receivables).map(item), payments: array(r.payments).map(item) };
}
export function mapStatement(v: unknown): Statement {
  const r = obj(v), t = obj(r.totals);
  return {
    company: mapCompany(r.company), currencyCode: currency(r.currencyCode), from: r.from === null ? null : date(r.from), to: date(r.to),
    openingBalance: money(r.openingBalance), totals: { debit: money(t.debit), credit: money(t.credit) }, closingBalance: money(r.closingBalance),
    generatedAt: str(r.generatedAt), movements: array(r.movements).map(x => { const m = obj(x); return {
      id: str(m.id), code: str(m.code), valueDate: date(m.valueDate), type: choice(m.type, MOVEMENT_TYPES), direction: choice(m.direction, ["debit", "credit"] as const),
      orderCode: nullable(m.orderCode), method: method(m.method), externalReference: nullable(m.externalReference), reasonCode: nullable(m.reasonCode),
      reversesCode: nullable(m.reversesCode), reversedByCode: nullable(m.reversedByCode), debit: moneyNull(m.debit), credit: moneyNull(m.credit),
      runningBalance: money(m.runningBalance), createdAt: str(m.createdAt), createdBy: str(m.createdBy),
    }; }),
  };
}
export function mapAccountOverview(v: unknown): AccountOverview {
  const r = obj(v);
  return { nextCursor: nullable(r.nextCursor), capabilities: mapAccountCapabilities(r.capabilities), items: array(r.items).map(x => {
    const i = obj(x), b = obj(i.balances);
    return { companyId: str(i.companyId), companyCode: str(i.companyCode), legalName: str(i.legalName), displayName: nullable(i.displayName),
      companyStatus: choice(i.companyStatus, ["active", "inactive"] as const), balances: { RON: money(b.RON), EUR: money(b.EUR) },
      movementCount: count(i.movementCount), lastValueDate: i.lastValueDate === null ? null : date(i.lastValueDate) };
  }) };
}
export function mapAccountActivity(v: unknown): AccountActivityPage {
  const r = obj(v);
  return { nextCursor: nullable(r.nextCursor), items: array(r.items).map(x => {
    const e = obj(x), a = obj(e.actor);
    return { id: str(e.id), action: str(e.action), movementId: nullable(e.movementId), movementCode: nullable(e.movementCode), allocationId: nullable(e.allocationId),
      orderId: nullable(e.orderId), currencyCode: e.currencyCode === null ? null : currency(e.currencyCode), actor: { id: str(a.id), displayName: str(a.displayName) }, occurredAt: str(e.occurredAt) };
  }) };
}
export function mapAccountMutation(v: unknown): AccountMutation {
  const r = obj(v);
  return { companyId: str(r.companyId), movementId: str(r.movementId), allocationIds: array(r.allocationIds).map(str), summary: r.summary === null ? null : mapAccountSummary(r.summary) };
}
