# Current Account V1 (B2B 0.4.0)

The B2B view of the Operations API current account ledger (API 2.10.0, see `staff_arasyahome/docs/b2b-current-account.md` for the server rules). The browser shows server figures only: balances, totals, running balances and statement files all come from the API. Amounts travel as decimal strings; client-side checks (amount format, allocation limits) use integer cents (`BigInt`) and only prevent obviously invalid requests. The server decides.

## Where it appears

- **Conturi curente / Cari hesaplar** (`/conturi-curente`): every company with its RON and EUR balance, search, an "only with balance" filter and company status filter. Requires `b2b.accounts.view`.
- `/conturi-curente/{companyId}` and the **Cont curent / Cari hesap** tab of a company: the account panel.
- The Dashboard shows no account data; it only labels the permissions for role composition.

## Account panel

- One card per currency: what the company owes (positive balance) or its credit (negative), total debit and credit, receivables not yet settled by allocations, unallocated payments, and whether an opening balance is active. RON and EUR are never combined.
- Movements, newest first, filterable by currency, type and business date. Reversed movements are struck through and linked to their reversal; an automatic reversal from an order cancellation is labelled as such.
- **Payment** (`record_payment`): currency, amount, business date (not in the future), method and the method's reference rules (bank transfer needs a reference; compensation a reference or a note; "other" a note). Optional allocation to open receivables of the same currency, with "allocate the rest" helpers. Overpayment is allowed.
- **Allocate** an existing payment, and **release** an allocation with a reason (`record_payment`).
- **Opening balance** and **adjustment** (`adjust`) with a mandatory reason. An inactive company only allows credit adjustments.
- **Reverse** a payment, opening balance or adjustment (`reverse`) with a date and a reason. Order receivables are reversed only by cancelling the order.
- **Statement**: on-screen view for any period, CSV and PDF download (`export` plus `view`) rendered by the server in the interface language.
- Activity: who posted, reversed, allocated or released what, and when.

Each submission is one intent with one Idempotency-Key: retrying the same content reuses the key, so a double click or a network retry never posts twice. Every mutation needs the CSRF token, and the panel refreshes from the server summary after each one.
