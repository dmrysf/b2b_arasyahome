# Arasya B2B

Wholesale sales management for Arasya (`https://b2b.arasyahome.ro`). Romanian: **Management vânzări en-gros**; Turkish: **Toptan Satış Yönetimi**.

Arasya B2B is an internal application for Arasya employees who manage wholesale customers. It is not a customer portal.

**Version 0.2.0 adds Companies V1** on top of the 0.1.0 Foundation: wholesale companies with server-generated UUIDs and `B2B-000001` codes, fiscal identity (country + tax identifier, duplicate-protected), multiple contacts and typed addresses, internal notes, deactivate/reactivate, concurrent-edit review and an immutable activity history. It still contains no orders, current accounts, products, prices, inventory or production integration. See [`docs/companies.md`](docs/companies.md) and [`docs/b2b-roadmap.md`](docs/b2b-roadmap.md).

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
