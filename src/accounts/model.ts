import type { Locale } from "../i18n";

/** Routes of the top-level Current Accounts module (Romanian paths, like the rest of B2B). */
export const ACCOUNTS_PATH = "/conturi-curente";
export const accountPath = (companyId: string) => `${ACCOUNTS_PATH}/${encodeURIComponent(companyId)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type AccountsRoute = { kind: "list" } | { kind: "company"; id: string } | null;

export function accountsRoute(pathname: string): AccountsRoute {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (path === ACCOUNTS_PATH) return { kind: "list" };
  if (path.startsWith(`${ACCOUNTS_PATH}/`)) {
    const id = decodeURIComponent(path.slice(ACCOUNTS_PATH.length + 1));
    return UUID.test(id) ? { kind: "company", id } : null;
  }
  return null;
}

/** Today's business date (YYYY-MM-DD) in the Arasya business time zone, the latest date the server accepts. */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isBusinessDate(value: string, today = businessToday()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01" || value > today) return false;
  const [y, m, d] = value.split("-").map((part) => Number.parseInt(part, 10));
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

/**
 * A typed amount as the exact decimal string the API expects ("12", "12,5" -> "12.50"), or null when it is not a
 * positive amount with at most two decimals. Text only; never a floating point number.
 */
export function normalizeAmount(input: string): string | null {
  const match = /^(\d{1,10})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const cents = (match[2] ?? "").padEnd(2, "0");
  return toCents(`${whole}.${cents}`) > 0n ? `${whole}.${cents}` : null;
}

/** Integer cents of a server or normalized amount ("-160.65" -> -16065n). Client-side checks only; the server decides. */
export function toCents(value: string): bigint {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid amount.");
  const cents = BigInt(match[2]) * 100n + BigInt(match[3]);
  return match[1] === "-" ? -cents : cents;
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Display form of a server amount with grouping, built from the text so no precision is ever lost. */
export function formatMoney(value: string, locale: Locale, currency?: string): string {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) return value;
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const text = `${match[1] === "-" ? "−" : ""}${grouped},${match[3]}`;
  void locale; // Romanian and Turkish share the same separators.
  return currency ? `${text} ${currency}` : text;
}

export type BalanceKind = "owes" | "credit" | "settled";
export function balanceKind(value: string): BalanceKind {
  const cents = toCents(value);
  return cents > 0n ? "owes" : cents < 0n ? "credit" : "settled";
}

/** The amount without its sign, for "credit 120,00" style display. */
export const absolute = (value: string) => value.replace(/^-/, "");

export function statementFilename(companyCode: string, currency: string, to: string, extension: "csv" | "pdf"): string {
  return `extras-${companyCode}-${currency}-${to}.${extension}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Saves bytes the server produced. The object URL lives only for the click. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
