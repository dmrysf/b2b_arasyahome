# Arasya B2B

Version 0.8.2: the browser tab icon is now the Arasya "A" taken from the company wordmark, black on a white tile so it reads on light and dark tab bars (`favicon.svg`, a 16/32/48 px `favicon.ico` and a 180 px `apple-touch-icon.png`). Same icon as Staff 2.20.1 and Dashboard 0.12.2.

Version 0.8.1 makes the project 2D sketch state what it shows: a window without a width or height names the missing dimension instead of drawing an empty frame, and every sketch lists each treatment (type, product code, colour, size), the stored wall position and the project revision it was drawn from. The sketch still reads only the `arasya.scene/1` document. Two layout fixes found by CI before 0.8.1 was released: the root account badge on the home page wraps on a 320 px phone instead of leaving its card, and the companies table scrolls sideways on a tablet instead of cutting off its last columns. The responsive sweep now also fails when content sticks out of its card. Works with Operations API 2.22 and later.

Version 0.8.0 makes the first login explicit: the forced change is titled *Setați parola personală* and states that a personal password is required before any company information; every password field has its own Show/Hide control with a distinct accessible name and `aria-pressed`; Romanian and Turkish checks run before the request (all fields, 12 characters, different from the current password, no username, matching confirmation) while the Operations API stays the authority; *Schimbați parola* in the account area offers a voluntary change of the one central password. Works with Operations API 2.22 and later.

Version 0.7.0 prints the canonical Arasya production ticket (Operations API 2.16.0): the B2B handoff generates revision 1, the workshop download is recorded centrally as a print or reprint of the active revision with the same QR, and a stale or revoked document cannot be printed. The commercial proposal PDF is unchanged.

Version 0.6.2 aligns the read-only Turkish cutting-stage label (Kesim) with API 2.14.0.
Commerce, account ledger, handoff and project behavior are unchanged.

Wholesale sales management for Arasya (`https://b2b.arasyahome.ro`). Romanian: **Management vânzări en-gros**; Turkish: **Toptan Satış Yönetimi**.

Arasya B2B is an internal application for Arasya employees who manage wholesale customers. It is not a customer portal.

Version 0.6.0 adds [Projects](docs/projects.md): the home page separates **Comandă rapidă** (the unchanged Classic wholesale workstation) from **Proiect nou** (field projects for hotels, villas, offices, hospitals). A tablet-first workspace edits floors, rooms, openings and treatments with debounced, retrying, version-checked autosave, repeats rooms and windows explicitly, shows a structural 2D sketch from the `arasya.scene/1` contract, downloads a premium proposal PDF and converts selected rooms into a normal Classic draft exactly once. Order pages show the project origin; production cards download the workshop sheet. Requires Operations API 2.12.0 / migration 013, Dashboard 0.5.5 labels and Staff 2.3.3.

Version 0.5.0 adds [explicit Operations + Staff integration V1](docs/production.md). Finalization remains commercial freeze + receivable only. A separate permission-gated, confirmed submission creates one canonical `b2b` production order, without changing prices or the current account. Progress is read-only and refreshed from Operations; commercial cancellation is blocked after any submission. Requires Operations API 2.11.0 / additive migration 012, Dashboard 0.5.4 permission labels, and Staff 2.3.2 manufacturing context. No automatic role grants, source writeback or production cancellation.

Version 0.4.1 is a corrective release found in production acceptance: on phones (390 and 360 px) the payment form's allocation table widened the page; it now scrolls inside its own box. Frontend only; no API, migration or permission change.

Version 0.4.0 adds [Current Account V1](docs/current-account.md): RON and EUR balances per company, movements, payments with optional allocations, opening balances, adjustments, reversals and CSV/PDF statements, in the company detail (`Cont curent` tab) and in the top-level `Conturi curente` module. Every figure comes from the Operations API ledger (2.10.0, migration 011); the browser never computes an authoritative amount. Finalized orders post their receivable automatically; there is no manual posting, no FX, no payment terms or credit limits, and orders are never blocked by a balance.

Version 0.3.1 is a corrective release found in production acceptance: finalized and cancelled orders show their historical contact and address snapshots in the header (never "selected record unavailable"), line counts use correct Romanian and Turkish plural forms ("1 produs", "3 produse", "20 de produse"; "3 ürün"), and the home page names both available modules, Companies and Orders. It pairs with Operations API 2.9.1, which records `line_updated` activity only for real line changes.

Version 0.3.0 adds [Classic / Quick Order Builder V1](docs/classic-orders.md): explicit commercial draft saving, up to 100 stable product rows, exact RON/EUR pricing, finalization/cancellation with frozen snapshots, duplication and company order history. It extends Companies V1 on the existing central identity. Requires Operations API 2.9.0 / migration 010 and Dashboard 0.5.2 permission labels. No production submission, ledger, payment, inventory or source writeback.

## Companies 0.2.0

- `/companii`: server-side search (code, name, tax identifier, city), status and country filters, keyset pages of 50.
- `/companii/noua`: legal name, country and tax identifier are enough; an optional primary contact and primary address.
- `/companii/{id}`: company information, contacts, addresses, internal notes and activity in separate sections.
- Needs `b2b.access` plus `b2b.companies.view`, `.create`, `.update` or `.manage_status`, composed into roles in the Dashboard. Requires Operations API 2.8.0.

## What the Foundation (0.1.0) provides

- Signs in with the existing central Arasya account through `https://api.arasyahome.ro` (Operations API 2.8.0+ for Companies). B2B has no users, passwords, sessions or tokens of its own.
- Opens only for identities with the Central IAM application `b2b` (permission `b2b.access`), confirmed by the server gate `GET /b2b/access`. Others see **Nu aveți acces la aplicația B2B.** / **B2B uygulamasına erişim yetkiniz bulunmuyor.**
- Handles every session state: checking, signed out, forced temporary-password change, no B2B access, B2B authorized, and revoked or deactivated sessions. Removing B2B access in the Dashboard closes B2B on the next check (tab focus, at most one minute, or the next request).
- Shows a restrained landing page with the identity from Central IAM, the available Companies module and the planned modules as disabled placeholders.
- Romanian (default and fallback) and Turkish, switched with RO | TR. The browser language is never used. The only browser-storage entry is `arasya.b2b.locale`.

## Stack

React 19, TypeScript 5.9 and Vite 8, the same stack as the Dashboard, with two runtime dependencies (`react`, `react-dom`) and no UI framework.

```
src/
  api/          the only Operations API client (credentials: include, CSRF in memory) and the Companies contract
  companies/    Companies V1: list, create, detail, forms, concurrency editor, idempotency intents
  auth/         session classification and the B2B gate
  components/   small shared UI pieces
  i18n/         ro.ts (reference shape), tr.ts, the locale preference
  layout/       application shell and planned-module list
  pages/        login, password change, no access, home, not found
  styles/
tests/          unit tests (node:test via tsx) and the deploy-script test
e2e/            Chromium smoke (API double) and real Operations API suites
scripts/        build verification, CSP generation, cPanel deploy and rollback
docs/           architecture, security, deployment, roadmap
```

## Development

```bash
pnpm install --frozen-lockfile
export VITE_B2B_API_BASE_URL=https://api.arasyahome.ro
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm test:e2e:smoke        # Chromium against the production build with an in-memory API double
pnpm verify                              # everything CI runs before a release, including the deploy-script test
```

Real Operations API suite (MySQL 8.4 or MariaDB 10.11): check out `dmrysf/staff_arasyahome` at the commit in `e2e/operations-api.ref`, link its `operations-api` directory here, then:

```bash
ARASYA_E2E_DB_NAME=arasya_b2b_e2e_test ARASYA_TEST_DB_USER=... ARASYA_TEST_DB_PASSWORD=... pnpm test:e2e:real
```

The fixture refuses any database whose name does not contain both `e2e` and `test`.

## Documentation

- [`docs/companies.md`](docs/companies.md): Companies V1: identity, code, fiscal identity, contacts, addresses, permissions, concurrency, idempotency, privacy and future relationships.
- [`docs/architecture.md`](docs/architecture.md): Central IAM relationship, application separation, the B2B domain and future Operations and inventory integration.
- [`docs/security.md`](docs/security.md): session, CSRF, origin, CSP and storage rules.
- [`docs/deployment.md`](docs/deployment.md): CI gates, release artifact, cPanel deploy and rollback.
- [`docs/b2b-roadmap.md`](docs/b2b-roadmap.md): planned milestones.
