import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { B2bApi } from "../api/client";
import {
  ACCOUNT_CURRENCIES, MOVEMENT_TYPES, PAYMENT_METHODS, type AccountActivity, type AccountCurrency, type AccountMutation, type AccountSummary, type Direction,
  type Movement, type MovementDetail, type MovementQuery, type OpenItem, type PaymentMethod, type Statement,
} from "../api/accounts";
import { ApiError } from "../api/errors";
import { Intent } from "../companies/idempotency";
import { useI18n } from "../i18n/context";
import { absolute, balanceKind, businessToday, formatMoney, fromCents, isBusinessDate, normalizeAmount, saveFile, statementFilename, toCents } from "./model";

type Notice = { tone: "success"; text: string } | null;
type Form = { kind: "payment" } | { kind: "opening" } | { kind: "adjustment" } | null;

/**
 * One company's current account: RON and EUR balances, movements, payments, allocations, opening balance, adjustments,
 * reversals and statements. Every figure is the server's; actions are offered from the server capabilities and the
 * server still authorizes each request.
 */
export function AccountPanel({ api, companyId }: { api: B2bApi; companyId: string }) {
  const { t, problem } = useI18n();
  const a = t.accounts;
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState<Form>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    api.accountSummary(companyId).then((value) => { if (active) { setSummary(value); setError(null); } }, (e) => { if (active) setError(e); });
    return () => { active = false; };
  }, [api, companyId, revision]);

  /** After any mutation: show the server's fresh summary and reload the lists that depend on it. */
  const changed = useCallback((result: AccountMutation, message: string) => {
    if (result.summary) setSummary(result.summary);
    setForm(null);
    setNotice({ tone: "success", text: message });
    setRevision((value) => value + 1);
  }, []);

  if (!summary) return error ? <p className="notice notice-error" role="alert">{problem(error)}</p> : <p className="muted" role="status">{a.loading}</p>;
  const caps = summary.capabilities;
  const active = caps.companyActive;
  return (
    <div className="account-panel">
      {!active && <p className="notice notice-warning" role="note">{a.inactiveHint}</p>}
      {notice && <p className="notice notice-success" role="status">{notice.text}</p>}
      <div className="account-balances">
        {ACCOUNT_CURRENCIES.map((currency) => <BalanceCard key={currency} currency={currency} summary={summary} />)}
      </div>
      <p className="hint">{a.signHint}</p>
      {(caps.canRecordPayment || caps.canAdjust) && (
        <div className="form-actions account-actions">
          {caps.canRecordPayment && <button type="button" className="button button-primary" aria-expanded={form?.kind === "payment"} onClick={() => { setNotice(null); setForm({ kind: "payment" }); }}>{a.recordPayment}</button>}
          {caps.canAdjust && active && <button type="button" className="button button-secondary" aria-expanded={form?.kind === "opening"} onClick={() => { setNotice(null); setForm({ kind: "opening" }); }}>{a.openingBalance}</button>}
          {caps.canAdjust && <button type="button" className="button button-secondary" aria-expanded={form?.kind === "adjustment"} onClick={() => { setNotice(null); setForm({ kind: "adjustment" }); }}>{a.adjustment}</button>}
        </div>
      )}
      {form?.kind === "payment" && <PaymentForm api={api} companyId={companyId} onCancel={() => setForm(null)} onDone={(r) => changed(r, a.payment_ok)} />}
      {form && form.kind !== "payment" && <EntryForm key={form.kind} api={api} companyId={companyId} kind={form.kind} active={active} summary={summary}
        onCancel={() => setForm(null)} onDone={(r) => changed(r, form.kind === "opening" ? a.opening_ok : a.adjustment_ok)} />}
      <MovementsSection key={`m${revision}`} api={api} companyId={companyId} summary={summary} onChanged={changed} />
      <StatementSection key={`s${revision}`} api={api} summary={summary} />
      <ActivitySection key={`a${revision}`} api={api} companyId={companyId} />
    </div>
  );
}

function BalanceCard({ currency, summary }: { currency: AccountCurrency; summary: AccountSummary }) {
  const { t, locale } = useI18n();
  const a = t.accounts;
  const s = summary.currencies[currency];
  const kind = balanceKind(s.balance);
  return (
    <section className={`card account-balance balance-${kind}`} aria-label={`${a.balance} ${currency}`}>
      <div className="card-header"><h2>{currency}</h2>{s.activeOpeningBalance && <span className="badge badge-muted">{a.openingActive}</span>}</div>
      <p className="account-balance-value"><span className="muted">{kind === "owes" ? a.owes : kind === "credit" ? a.credit : a.settled}</span>
        <strong className="mono">{formatMoney(absolute(s.balance), locale, currency)}</strong></p>
      <dl className="facts">
        <div><dt>{a.debits}</dt><dd className="mono">{formatMoney(s.debits, locale)}</dd></div>
        <div><dt>{a.credits}</dt><dd className="mono">{formatMoney(s.credits, locale)}</dd></div>
        <div><dt>{a.outstanding}</dt><dd className="mono">{formatMoney(s.outstandingReceivables, locale)}</dd></div>
        <div><dt>{a.unallocated}</dt><dd className="mono">{formatMoney(s.unallocatedPayments, locale)}</dd></div>
      </dl>
      <p className="meta">{a.movementCount(s.movementCount)}</p>
    </section>
  );
}

/** Server field failures shown next to the form, by field name and stable reason, never by submitted value. */
function ServerProblem({ error }: { error: unknown }) {
  const { t, problem } = useI18n();
  const a = t.accounts;
  if (!error) return null;
  const fields = error instanceof ApiError ? error.fields : {};
  const label = (field: string) => (Object.hasOwn(a.fields, field) ? a.fields[field as keyof typeof a.fields] : field);
  const reason = (value: string) => (Object.hasOwn(a.reasons, value) ? a.reasons[value as keyof typeof a.reasons] : value);
  return (
    <div className="form-error" role="alert">
      <p>{problem(error)}</p>
      {Object.keys(fields).length > 0 && <ul>{Object.entries(fields).map(([field, value]) => <li key={field}>{label(field)}: {reason(value)}</li>)}</ul>}
    </div>
  );
}

function Field({ label, children, message, hint }: { label: string; children: (id: string) => ReactNode; message?: string | null; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
      {message && <p className="field-message">{message}</p>}
    </div>
  );
}

/** Submits one intent: a retry of the same content reuses its Idempotency-Key, so the server applies it once. */
function useSubmit() {
  const intent = useRef(new Intent());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (payload: unknown, action: (key: string) => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action(intent.current.keyFor(payload));
      intent.current.done();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

type AllocationRows = Record<string, string>;

/** Allocation inputs for open receivables of one currency, with client-side limits that mirror the server's. */
function AllocationEditor({ items, rows, setRows, limit }: { items: OpenItem[]; rows: AllocationRows; setRows: (rows: AllocationRows) => void; limit: string | null }) {
  const { t, locale } = useI18n();
  const a = t.accounts;
  const chosen = allocationTotal(rows);
  const limitCents = limit ? toCents(limit) : null;
  if (items.length === 0) return <p className="muted">{a.noOpenReceivables}</p>;
  return (
    <div className="allocation-editor">
      <div className="table-scroll">
      <table className="account-table allocation-table">
        <thead><tr><th>{a.document}</th><th>{a.valueDate}</th><th className="num">{a.open}</th><th className="num">{a.amount}</th><th /></tr></thead>
        <tbody>
          {items.map((item) => {
            const value = rows[item.id] ?? "";
            const normalized = value ? normalizeAmount(value) : null;
            const tooLarge = normalized !== null && toCents(normalized) > toCents(item.openAmount);
            const rest = limitCents === null ? toCents(item.openAmount) : (() => {
              const others = chosen.cents - (normalized ? toCents(normalized) : 0n);
              const free = limitCents - others;
              return free < toCents(item.openAmount) ? free : toCents(item.openAmount);
            })();
            return (
              <tr key={item.id}>
                <td><span className="mono">{item.orderCode ?? item.code}</span></td>
                <td>{item.valueDate}</td>
                <td className="num mono">{formatMoney(item.openAmount, locale)}</td>
                <td className="num"><input inputMode="decimal" aria-label={`${a.amount} ${item.orderCode ?? item.code}`} value={value} aria-invalid={Boolean(value) && (normalized === null || tooLarge)}
                  onChange={(event) => setRows({ ...rows, [item.id]: event.target.value })} /></td>
                <td><button type="button" className="button button-ghost" disabled={rest <= 0n} onClick={() => setRows({ ...rows, [item.id]: fromCents(rest) })}>{a.allocateFull}</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {limit && <p className="meta" role="status">{a.allocatedTotal(formatMoney(fromCents(chosen.cents), locale), formatMoney(fromCents(toCents(limit) - chosen.cents), locale))}</p>}
    </div>
  );
}

function allocationTotal(rows: AllocationRows): { cents: bigint; valid: boolean } {
  let cents = 0n;
  let valid = true;
  for (const value of Object.values(rows)) {
    if (!value.trim()) continue;
    const normalized = normalizeAmount(value);
    if (normalized === null) { valid = false; continue; }
    cents += toCents(normalized);
  }
  return { cents, valid };
}

function allocationList(rows: AllocationRows) {
  return Object.entries(rows).filter(([, value]) => value.trim() !== "").map(([receivableId, value]) => ({ receivableId, amount: normalizeAmount(value) ?? value }));
}

function allocationsFit(rows: AllocationRows, items: OpenItem[], limit: string | null): boolean {
  const total = allocationTotal(rows);
  if (!total.valid || (limit !== null && total.cents > toCents(limit))) return false;
  return allocationList(rows).every(({ receivableId, amount }) => {
    const item = items.find((candidate) => candidate.id === receivableId);
    return item !== undefined && toCents(amount) <= toCents(item.openAmount);
  });
}

function useOpenItems(api: B2bApi, companyId: string, currency: AccountCurrency) {
  const [items, setItems] = useState<{ currency: AccountCurrency; receivables: OpenItem[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let active = true;
    api.accountOpenItems(companyId, currency).then((value) => { if (active) setItems({ currency, receivables: value.receivables }); }, (e) => { if (active) setError(e); });
    return () => { active = false; };
  }, [api, companyId, currency]);
  return { receivables: items?.currency === currency ? items.receivables : null, error };
}

function PaymentForm({ api, companyId, onCancel, onDone }: { api: B2bApi; companyId: string; onCancel: () => void; onDone: (result: AccountMutation) => void }) {
  const { t } = useI18n();
  const a = t.accounts;
  const today = businessToday();
  const [currency, setCurrency] = useState<AccountCurrency>("RON");
  const [amount, setAmount] = useState("");
  const [valueDate, setValueDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<AllocationRows>({});
  const [checked, setChecked] = useState(false);
  const open = useOpenItems(api, companyId, currency);
  const action = useSubmit();
  const normalized = normalizeAmount(amount);
  const referenceRequired = method === "bank_transfer";
  const noteRequired = method === "other" || (method === "compensation" && !reference.trim());
  const errors = {
    amount: normalized ? null : a.invalidAmount,
    valueDate: isBusinessDate(valueDate, today) ? null : a.invalidDate,
    reference: referenceRequired && !reference.trim() ? a.required : null,
    note: noteRequired && !note.trim() ? a.required : null,
    allocations: allocationsFit(rows, open.receivables ?? [], normalized) ? null : a.allocationTooLarge,
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (Object.values(errors).some(Boolean) || !normalized) return;
    const body = { currencyCode: currency, amount: normalized, valueDate, method, externalReference: reference.trim() || null, note: note.trim() || null, allocations: allocationList(rows) };
    void action.submit(body, async (key) => onDone(await api.recordPayment(companyId, body, { idempotencyKey: key })));
  };
  const show = (message: string | null) => (checked ? message : null);
  return (
    <form className="card inline-form account-form" onSubmit={submit} noValidate aria-label={a.paymentTitle}>
      <h2>{a.paymentTitle}</h2>
      <div className="account-form-grid">
        <Field label={a.currency}>{(id) => <select id={id} value={currency} onChange={(event) => { setCurrency(event.target.value as AccountCurrency); setRows({}); }}>{ACCOUNT_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
        <Field label={a.amount} message={show(errors.amount)}>{(id) => <input id={id} inputMode="decimal" autoComplete="off" value={amount} aria-invalid={Boolean(show(errors.amount))} onChange={(event) => setAmount(event.target.value)} />}</Field>
        <Field label={a.valueDate} message={show(errors.valueDate)}>{(id) => <input id={id} type="date" max={today} value={valueDate} aria-invalid={Boolean(show(errors.valueDate))} onChange={(event) => setValueDate(event.target.value)} />}</Field>
        <Field label={a.method}>{(id) => <select id={id} value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{a.methods[m]}</option>)}</select>}</Field>
        <Field label={`${a.externalReference} — ${referenceRequired ? a.referenceRequired : a.referenceOptional}`} message={show(errors.reference)}>
          {(id) => <input id={id} maxLength={160} value={reference} aria-invalid={Boolean(show(errors.reference))} onChange={(event) => setReference(event.target.value)} />}
        </Field>
        <Field label={noteRequired ? a.noteRequired : a.note} message={show(errors.note)}>{(id) => <input id={id} maxLength={2000} value={note} aria-invalid={Boolean(show(errors.note))} onChange={(event) => setNote(event.target.value)} />}</Field>
      </div>
      <fieldset className="account-fieldset">
        <legend>{a.allocate}</legend>
        <p className="hint">{a.allocateHint}</p>
        {open.error ? <ServerProblem error={open.error} /> : open.receivables === null ? <p className="muted">{a.loading}</p>
          : <AllocationEditor items={open.receivables} rows={rows} setRows={setRows} limit={normalized} />}
        {show(errors.allocations) && <p className="field-message">{errors.allocations}</p>}
      </fieldset>
      <ServerProblem error={action.error} />
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={action.busy}>{action.busy ? a.saving : a.save}</button>
        <button type="button" className="button button-ghost" disabled={action.busy} onClick={onCancel}>{a.cancel}</button>
      </div>
    </form>
  );
}

function EntryForm({ api, companyId, kind, active, summary, onCancel, onDone }: {
  api: B2bApi; companyId: string; kind: "opening" | "adjustment"; active: boolean; summary: AccountSummary; onCancel: () => void; onDone: (result: AccountMutation) => void;
}) {
  const { t } = useI18n();
  const a = t.accounts;
  const today = businessToday();
  const [currency, setCurrency] = useState<AccountCurrency>("RON");
  // An inactive company can only receive credit adjustments.
  const [direction, setDirection] = useState<Direction>(active ? "debit" : "credit");
  const [amount, setAmount] = useState("");
  const [valueDate, setValueDate] = useState(today);
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const action = useSubmit();
  const normalized = normalizeAmount(amount);
  const errors = { amount: normalized ? null : a.invalidAmount, valueDate: isBusinessDate(valueDate, today) ? null : a.invalidDate, reason: reason.trim() ? null : a.required };
  const blocked = kind === "opening" && summary.currencies[currency].activeOpeningBalance;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (Object.values(errors).some(Boolean) || !normalized || blocked) return;
    const body = { currencyCode: currency, direction, amount: normalized, valueDate, reason: reason.trim() };
    void action.submit({ kind, ...body }, async (key) => onDone(await (kind === "opening" ? api.postOpeningBalance : api.postAdjustment)(companyId, body, { idempotencyKey: key })));
  };
  const show = (message: string | null) => (checked ? message : null);
  return (
    <form className="card inline-form account-form" onSubmit={submit} noValidate aria-label={kind === "opening" ? a.openingTitle : a.adjustmentTitle}>
      <h2>{kind === "opening" ? a.openingTitle : a.adjustmentTitle}</h2>
      <p className="hint">{kind === "opening" ? a.openingHint : a.adjustmentHint}</p>
      <div className="account-form-grid">
        <Field label={a.currency}>{(id) => <select id={id} value={currency} onChange={(event) => setCurrency(event.target.value as AccountCurrency)}>{ACCOUNT_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
        <Field label={a.direction}>{(id) => (
          <select id={id} value={direction} onChange={(event) => setDirection(event.target.value as Direction)}>
            <option value="debit" disabled={!active}>{a.debitOption}</option>
            <option value="credit">{a.creditOption}</option>
          </select>
        )}</Field>
        <Field label={a.amount} message={show(errors.amount)}>{(id) => <input id={id} inputMode="decimal" autoComplete="off" value={amount} aria-invalid={Boolean(show(errors.amount))} onChange={(event) => setAmount(event.target.value)} />}</Field>
        <Field label={a.valueDate} message={show(errors.valueDate)}>{(id) => <input id={id} type="date" max={today} value={valueDate} aria-invalid={Boolean(show(errors.valueDate))} onChange={(event) => setValueDate(event.target.value)} />}</Field>
      </div>
      <Field label={a.reason} message={show(errors.reason)}>{(id) => <textarea id={id} rows={2} maxLength={2000} value={reason} aria-invalid={Boolean(show(errors.reason))} onChange={(event) => setReason(event.target.value)} />}</Field>
      {blocked && <p className="notice notice-warning" role="note">{t.errors.OPENING_BALANCE_EXISTS}</p>}
      <ServerProblem error={action.error} />
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={action.busy || blocked}>{action.busy ? a.saving : a.save}</button>
        <button type="button" className="button button-ghost" disabled={action.busy} onClick={onCancel}>{a.cancel}</button>
      </div>
    </form>
  );
}

function MovementsSection({ api, companyId, summary, onChanged }: { api: B2bApi; companyId: string; summary: AccountSummary; onChanged: (result: AccountMutation, message: string) => void }) {
  const { t, problem } = useI18n();
  const a = t.accounts;
  const [query, setQuery] = useState<MovementQuery>({ currency: "all", type: "all", from: "", to: "" });
  const [page, setPage] = useState<{ key: string; items: Movement[]; next: string | null } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify({ ...query, limit: 25 });
  useEffect(() => {
    let active = true;
    api.accountMovements(companyId, JSON.parse(key) as MovementQuery).then(
      (value) => { if (active) { setPage({ key, items: value.items, next: value.nextCursor }); setError(null); } },
      (e) => { if (active) setError(e); },
    );
    return () => { active = false; };
  }, [api, companyId, key]);
  const data = page?.key === key ? page : null;
  const more = async () => {
    if (!data?.next) return;
    setBusy(true);
    try {
      const next = await api.accountMovements(companyId, { ...JSON.parse(key) as MovementQuery, cursor: data.next });
      setPage((old) => (old?.key === key ? { key, items: [...old.items, ...next.items], next: next.nextCursor } : old));
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <section className="card" aria-labelledby={`movements-${companyId}`}>
      <h2 id={`movements-${companyId}`}>{a.movements}</h2>
      <div className="account-filters">
        <Field label={a.currency}>{(id) => <select id={id} value={query.currency} onChange={(event) => setQuery({ ...query, currency: event.target.value as MovementQuery["currency"] })}>
          <option value="all">{a.all}</option>{ACCOUNT_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
        <Field label={a.type}>{(id) => <select id={id} value={query.type} onChange={(event) => setQuery({ ...query, type: event.target.value as MovementQuery["type"] })}>
          <option value="all">{a.all}</option>{MOVEMENT_TYPES.map((type) => <option key={type} value={type}>{a.types[type]}</option>)}</select>}</Field>
        <Field label={a.from}>{(id) => <input id={id} type="date" value={query.from} onChange={(event) => setQuery({ ...query, from: event.target.value })} />}</Field>
        <Field label={a.to}>{(id) => <input id={id} type="date" value={query.to} min={query.from} onChange={(event) => setQuery({ ...query, to: event.target.value })} />}</Field>
      </div>
      {error !== null && <p className="notice notice-error" role="alert">{problem(error)}</p>}
      {data && data.items.length === 0 && <p className="muted">{a.noMovements}</p>}
      {data && data.items.length > 0 && (
        <ul className="movement-list">
          {data.items.map((movement) => <li key={movement.id}><MovementRow api={api} companyId={companyId} movement={movement} summary={summary} onChanged={onChanged} /></li>)}
        </ul>
      )}
      {(busy || (!data && error === null)) && <p className="muted" role="status">{a.loading}</p>}
      {data?.next && !busy && <div><button type="button" className="button button-secondary" onClick={() => { void more(); }}>{a.more}</button></div>}
    </section>
  );
}

function MovementRow({ api, companyId, movement, summary, onChanged }: { api: B2bApi; companyId: string; movement: Movement; summary: AccountSummary; onChanged: (result: AccountMutation, message: string) => void }) {
  const { t, locale, dateTime } = useI18n();
  const a = t.accounts;
  const [panel, setPanel] = useState<"details" | "reverse" | "allocate" | null>(null);
  const caps = summary.capabilities;
  const reversible = caps.canReverse && movement.type !== "reversal" && movement.type !== "order_receivable" && movement.reversedBy === null;
  const allocatable = caps.canRecordPayment && movement.type === "payment" && movement.reversedBy === null && movement.open !== null && toCents(movement.open) > 0n;
  const toggle = (next: typeof panel) => setPanel((current) => (current === next ? null : next));
  return (
    <article className={`movement ${movement.reversedBy ? "is-reversed" : ""}`}>
      <div className="movement-main">
        <div className="movement-title">
          <span className="mono">{movement.code}</span>
          <strong>{a.types[movement.type]}</strong>
          {movement.orderCode && <span className="mono">{movement.orderCode}</span>}
          {movement.method && <span className="badge badge-muted">{a.methods[movement.method]}</span>}
          {movement.reverses && <span className="badge badge-muted">{a.reverses(movement.reverses.code)}</span>}
          {movement.reversedBy && <span className="badge badge-muted">{a.reversedBy(movement.reversedBy.code)}</span>}
        </div>
        <p className="meta">{a.valueDate}: {movement.valueDate} · {a.postedAt} {dateTime(movement.createdAt)} {a.postedBy} {movement.createdBy.displayName}</p>
        {movement.reasonCode === "order_cancelled" && <p className="meta">{a.orderCancelled}</p>}
        {movement.externalReference && <p className="meta">{a.reference}: {movement.externalReference}</p>}
        {movement.note && <p className="meta">{movement.type === "payment" ? a.note : a.reason}: {movement.note}</p>}
      </div>
      <div className="movement-amount">
        <span className={`amount amount-${movement.direction}`}>{a.directions[movement.direction]} <strong className="mono">{formatMoney(movement.amount, locale, movement.currencyCode)}</strong></span>
        {movement.open !== null && movement.reversedBy === null && <span className="meta">{a.open}: <span className="mono">{formatMoney(movement.open, locale)}</span></span>}
        <div className="form-actions">
          {(movement.type === "payment" || movement.type === "order_receivable") && <button type="button" className="button button-ghost" aria-expanded={panel === "details"} onClick={() => toggle("details")}>{panel === "details" ? a.hideDetails : a.details}</button>}
          {allocatable && <button type="button" className="button button-ghost" aria-expanded={panel === "allocate"} onClick={() => toggle("allocate")}>{a.allocateExisting}</button>}
          {reversible && <button type="button" className="button button-danger-ghost" aria-expanded={panel === "reverse"} onClick={() => toggle("reverse")}>{a.reverse}</button>}
        </div>
      </div>
      {panel === "details" && <MovementDetails api={api} companyId={companyId} movementId={movement.id} canRelease={caps.canRecordPayment} onChanged={onChanged} />}
      {panel === "allocate" && <AllocateForm api={api} companyId={companyId} payment={movement} onCancel={() => setPanel(null)} onDone={(r) => onChanged(r, a.allocation_ok)} />}
      {panel === "reverse" && <ReverseForm api={api} companyId={companyId} movement={movement} onCancel={() => setPanel(null)} onDone={(r) => onChanged(r, a.reversed_ok)} />}
      {movement.type === "order_receivable" && caps.canReverse && movement.reversedBy === null && panel === "details" && <p className="hint">{a.reverseReceivableHint}</p>}
    </article>
  );
}

function MovementDetails({ api, companyId, movementId, canRelease, onChanged }: { api: B2bApi; companyId: string; movementId: string; canRelease: boolean; onChanged: (result: AccountMutation, message: string) => void }) {
  const { t, locale, dateTime, problem } = useI18n();
  const a = t.accounts;
  const [detail, setDetail] = useState<MovementDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [releasing, setReleasing] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api.accountMovement(companyId, movementId).then((value) => { if (active) setDetail(value); }, (e) => { if (active) setError(e); });
    return () => { active = false; };
  }, [api, companyId, movementId]);
  if (error) return <p className="notice notice-error" role="alert">{problem(error)}</p>;
  if (!detail) return <p className="muted" role="status">{a.loading}</p>;
  return (
    <div className="movement-details">
      <h3>{a.allocations}</h3>
      {detail.allocations.length === 0 ? <p className="muted">{a.noAllocations}</p> : (
        <ul className="allocation-list">
          {detail.allocations.map((allocation) => (
            <li key={allocation.id} className={allocation.released ? "is-released" : undefined}>
              <div>
                <span className="mono">{allocation.paymentCode}</span> → <span className="mono">{allocation.orderCode ?? allocation.receivableCode}</span>
                {" · "}<strong className="mono">{formatMoney(allocation.amount, locale, allocation.currencyCode)}</strong>
                <p className="meta">{dateTime(allocation.createdAt)} {a.postedBy} {allocation.createdBy}</p>
                {allocation.released && <p className="meta">{a.released[allocation.released.kind]} · {dateTime(allocation.released.at)} {a.postedBy} {allocation.released.by}{allocation.released.reason ? ` · ${allocation.released.reason}` : ""}</p>}
              </div>
              {canRelease && !allocation.released && (releasing === allocation.id
                ? <ReleaseForm api={api} companyId={companyId} allocationId={allocation.id} onCancel={() => setReleasing(null)} onDone={(r) => onChanged(r, a.released_ok)} />
                : <button type="button" className="button button-ghost" onClick={() => setReleasing(allocation.id)}>{a.release}</button>)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReleaseForm({ api, companyId, allocationId, onCancel, onDone }: { api: B2bApi; companyId: string; allocationId: string; onCancel: () => void; onDone: (result: AccountMutation) => void }) {
  const { t } = useI18n();
  const a = t.accounts;
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const action = useSubmit();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!reason.trim()) return;
    void action.submit({ allocationId, reason: reason.trim() }, async (key) => onDone(await api.releaseAllocation(companyId, allocationId, reason.trim(), { idempotencyKey: key })));
  };
  return (
    <form className="inline-form" onSubmit={submit} noValidate>
      <Field label={a.releaseReason} message={checked && !reason.trim() ? a.required : null}>{(id) => <input id={id} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />}</Field>
      <ServerProblem error={action.error} />
      <div className="form-actions">
        <button type="submit" className="button button-danger" disabled={action.busy}>{action.busy ? a.saving : a.confirmRelease}</button>
        <button type="button" className="button button-ghost" disabled={action.busy} onClick={onCancel}>{a.cancel}</button>
      </div>
    </form>
  );
}

function ReverseForm({ api, companyId, movement, onCancel, onDone }: { api: B2bApi; companyId: string; movement: Movement; onCancel: () => void; onDone: (result: AccountMutation) => void }) {
  const { t } = useI18n();
  const a = t.accounts;
  const today = businessToday();
  const [valueDate, setValueDate] = useState(today);
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const action = useSubmit();
  const dateValid = isBusinessDate(valueDate, today) && valueDate >= movement.valueDate;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!dateValid || !reason.trim()) return;
    const body = { valueDate, reason: reason.trim() };
    void action.submit({ movementId: movement.id, ...body }, async (key) => onDone(await api.reverseMovement(companyId, movement.id, body, { idempotencyKey: key })));
  };
  return (
    <form className="inline-form" onSubmit={submit} noValidate aria-label={a.reverseTitle}>
      <h3>{a.reverseTitle} <span className="mono">{movement.code}</span></h3>
      <p className="hint">{a.reverseHint}</p>
      <div className="account-form-grid">
        <Field label={a.valueDate} message={checked && !dateValid ? a.invalidDate : null}>{(id) => <input id={id} type="date" min={movement.valueDate} max={today} value={valueDate} onChange={(event) => setValueDate(event.target.value)} />}</Field>
        <Field label={a.reason} message={checked && !reason.trim() ? a.required : null}>{(id) => <input id={id} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />}</Field>
      </div>
      <ServerProblem error={action.error} />
      <div className="form-actions">
        <button type="submit" className="button button-danger" disabled={action.busy}>{action.busy ? a.saving : a.confirmReverse}</button>
        <button type="button" className="button button-ghost" disabled={action.busy} onClick={onCancel}>{a.cancel}</button>
      </div>
    </form>
  );
}

function AllocateForm({ api, companyId, payment, onCancel, onDone }: { api: B2bApi; companyId: string; payment: Movement; onCancel: () => void; onDone: (result: AccountMutation) => void }) {
  const { t } = useI18n();
  const a = t.accounts;
  const open = useOpenItems(api, companyId, payment.currencyCode);
  const [rows, setRows] = useState<AllocationRows>({});
  const [checked, setChecked] = useState(false);
  const action = useSubmit();
  const limit = payment.open;
  const list = allocationList(rows);
  const fits = allocationsFit(rows, open.receivables ?? [], limit);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!fits || list.length === 0) return;
    void action.submit({ paymentId: payment.id, list }, async (key) => onDone(await api.allocatePayment(companyId, payment.id, list, { idempotencyKey: key })));
  };
  return (
    <form className="inline-form" onSubmit={submit} noValidate aria-label={a.allocateTitle}>
      <h3>{a.allocateTitle} <span className="mono">{payment.code}</span></h3>
      {open.error ? <ServerProblem error={open.error} /> : open.receivables === null ? <p className="muted">{a.loading}</p>
        : <AllocationEditor items={open.receivables} rows={rows} setRows={setRows} limit={limit} />}
      {checked && (!fits || list.length === 0) && <p className="field-message">{list.length === 0 ? a.required : a.allocationTooLarge}</p>}
      <ServerProblem error={action.error} />
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={action.busy || open.receivables?.length === 0}>{action.busy ? a.saving : a.save}</button>
        <button type="button" className="button button-ghost" disabled={action.busy} onClick={onCancel}>{a.cancel}</button>
      </div>
    </form>
  );
}

function StatementSection({ api, summary }: { api: B2bApi; summary: AccountSummary }) {
  const { t, locale } = useI18n();
  const a = t.accounts;
  const companyId = summary.company.id;
  const [currency, setCurrency] = useState<AccountCurrency>(summary.currencies.EUR.movementCount > 0 && summary.currencies.RON.movementCount === 0 ? "EUR" : "RON");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"show" | "csv" | "pdf" | null>(null);
  const query = { currency, from: from || undefined, to: to || undefined };
  const show = async () => {
    setBusy("show"); setError(null);
    try { setStatement(await api.accountStatement(companyId, query)); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const download = async (format: "csv" | "pdf") => {
    setBusy(format); setError(null);
    try {
      const blob = await api.accountStatementFile(companyId, format, { ...query, lang: locale });
      saveFile(blob, statementFilename(summary.company.code, currency, to || businessToday(), format));
    } catch (e) { setError(e); } finally { setBusy(null); }
  };
  return (
    <section className="card" aria-labelledby={`statement-${companyId}`}>
      <h2 id={`statement-${companyId}`}>{a.statement}</h2>
      <p className="hint">{a.statementHint}</p>
      <div className="account-filters">
        <Field label={a.currency}>{(id) => <select id={id} value={currency} onChange={(event) => { setCurrency(event.target.value as AccountCurrency); setStatement(null); }}>{ACCOUNT_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
        <Field label={a.from}>{(id) => <input id={id} type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setStatement(null); }} />}</Field>
        <Field label={a.to}>{(id) => <input id={id} type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setStatement(null); }} />}</Field>
      </div>
      <div className="form-actions">
        <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => { void show(); }}>{busy === "show" ? a.loading : a.show}</button>
        {summary.capabilities.canExport && <>
          <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => { void download("csv"); }}>{busy === "csv" ? a.downloading : a.downloadCsv}</button>
          <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => { void download("pdf"); }}>{busy === "pdf" ? a.downloading : a.downloadPdf}</button>
        </>}
      </div>
      {error !== null && <ServerProblem error={error} />}
      {statement && (
        <div className="table-scroll">
          <table className="account-table statement-table">
            <caption>{statement.company.legalName} · {statement.currencyCode} · {statement.from ?? a.fromStart} — {statement.to}</caption>
            <thead><tr><th>{a.valueDate}</th><th>{a.document}</th><th>{a.type}</th><th>{a.reference}</th><th className="num">{a.debit}</th><th className="num">{a.creditColumn}</th><th className="num">{a.running}</th></tr></thead>
            <tbody>
              <tr className="statement-edge"><td colSpan={6}>{a.openingRow}</td><td className="num mono">{formatMoney(statement.openingBalance, locale)}</td></tr>
              {statement.movements.map((row) => (
                <tr key={row.id}>
                  <td>{row.valueDate}</td><td className="mono">{row.code}</td><td>{a.types[row.type]}</td>
                  <td>{[row.orderCode, row.method ? a.methods[row.method] : null, row.externalReference, row.reversesCode ? a.reverses(row.reversesCode) : null, row.reversedByCode ? a.reversedBy(row.reversedByCode) : null].filter(Boolean).join(" · ")}</td>
                  <td className="num mono">{row.debit ? formatMoney(row.debit, locale) : ""}</td>
                  <td className="num mono">{row.credit ? formatMoney(row.credit, locale) : ""}</td>
                  <td className="num mono">{formatMoney(row.runningBalance, locale)}</td>
                </tr>
              ))}
              <tr className="statement-edge"><td colSpan={4}>{a.totals}</td><td className="num mono">{formatMoney(statement.totals.debit, locale)}</td><td className="num mono">{formatMoney(statement.totals.credit, locale)}</td><td /></tr>
              <tr className="statement-edge"><td colSpan={6}>{a.closingRow}</td><td className="num mono"><strong>{formatMoney(statement.closingBalance, locale, statement.currencyCode)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ActivitySection({ api, companyId }: { api: B2bApi; companyId: string }) {
  const { t, dateTime, problem } = useI18n();
  const a = t.accounts;
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AccountActivity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = async (next: string | null) => {
    setBusy(true);
    try {
      const page = await api.accountActivity(companyId, next);
      setEvents((previous) => (next ? [...previous, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const label = (action: string) => (Object.hasOwn(a.activityActions, action) ? a.activityActions[action as keyof typeof a.activityActions] : a.unknownAction);
  return (
    <section className="card">
      <div className="card-header">
        <h2>{a.activity}</h2>
        <button type="button" className="button button-ghost" aria-expanded={open} onClick={() => { const next = !open; setOpen(next); if (next && events.length === 0) void load(null); }}>{open ? a.hideDetails : a.details}</button>
      </div>
      {open && <>
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.id}>
              <div className="timeline-head"><strong>{label(event.action)}</strong>{event.movementCode && <span className="mono">{event.movementCode}</span>}{event.currencyCode && <span>{event.currencyCode}</span>}</div>
              <p className="meta">{event.actor.displayName} · {dateTime(event.occurredAt)}</p>
            </li>
          ))}
        </ol>
        {error !== null && <p className="notice notice-error" role="alert">{problem(error)}</p>}
        {busy && <p className="muted" role="status">{a.loading}</p>}
        {cursor && !busy && <div><button type="button" className="button button-secondary" onClick={() => { void load(cursor); }}>{a.more}</button></div>}
      </>}
    </section>
  );
}
