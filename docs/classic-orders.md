# Classic / Quick Order Builder V1 — B2B 0.3.0

Internal wholesale workstation, built on Companies V1 and Operations API 2.9.0 / additive migration 010. Central identity/session, CSRF, exact-origin rules and permission catalog remain authoritative; no separate B2B account or token storage.

Routes: /comenzi (server-side search, status/currency/date filters, 25-row keyset pages), /comenzi/noua (active company selection or company-preselected deep link), /comenzi/{UUID} (draft editor or frozen historical detail). Company detail includes its server-filtered order history.

Explicit Save draft: typing, row duplication/removal/reorder and previews do not autosave. Dirty navigation/back/reload/logout is guarded. Ctrl/Cmd+S saves; Tab/Enter move among native row fields; Alt+Enter adds and focuses a row. Rows retain UUIDs across save and reorder; only the affected input row changes state. Maximum 100 lines. Desktop/tablet/mobile layouts preserve values without horizontal page overflow.

Physical quantity and whole-line total meters are independent. Width/height never derive billing. Piece pricing uses quantity; meter pricing uses total meters exactly once. Product name/variant/color are manual snapshots, not a catalog integration. VAT and price are explicit, with incomplete drafts supported. Comma decimal typing is normalized to decimal strings, never monetary floats. Totals come only from the shared server calculator: base/discount/VAT HALF-UP to cents per line, then rounded-line sums. A fingerprint/generation gate prevents old or invalidated previews from replacing current results.

Currency RON/EUR is locked whenever saved or current lines carry a price, including zero. Clear all prices and save first; then choose another currency. No conversion.

Finalize requires a clean, complete saved draft and manage-status authority. Confirmation names company, order, line count, currency and totals and explains the commercial freeze and absence of production submission. Native modal focus/escape behavior is preserved. Finalized/cancelled records are read-only, company/contact/address snapshots remain visible even if live records change (since 0.3.1 the header selectors of a frozen order also show the snapshot, not live company options), and Cancel retains the record/history. Duplicate creates a new draft using current active company identity and new order/line UUIDs; source history is unchanged.

Each business mutation has one stable key per identical intent. Pending writes freeze fields and destructive controls. Connection failures preserve inputs and retry the same key, including a lost successful response. Version conflicts preserve the local draft, allow inspecting current server state and explicitly choosing server data or rebasing same-currency edits on a current draft. No automatic overwrite.

Permissions: b2b.access plus b2b.orders.view/create/update/manage_status. Company view is needed for the UI selector. Menus/actions are hidden or disabled without authority; the API independently enforces every action. Migration grants no roles; root composes sales roles through Dashboard 0.5.2.

RO is default, TR is complete, and only the locale preference persists in browser storage. Reduced motion disables new entry/attention/feedback animations. No animation/layout/UI dependency was added.

Verification: strict mapper/client/model units; browser smoke includes RO/TR, preview races, lost replies, pending freezes, conflicts, navigation guards and 100 rows at 360/390/768/1280/1920 widths with reduced motion; real sales-user lifecycle runs on MySQL 8.4 and MariaDB 10.11. Existing Companies/auth/Staff/Dashboard/inbound-only suites remain required.

No production submission, payment/ledger/invoicing, stock, product pricing automation, source commerce writeback or generic reporting is included. Deployment remains manual: database/config backup → API 2.9.0 code/migrate/seed/readiness → Dashboard labels and explicit grants → B2B 0.3.0. See [deployment](deployment.md). Roll B2B back to 0.2.0 before rolling API code back to 2.8.0; retain additive migration 010 and commercial records.
