# Security

B2B introduces no security model of its own. It uses the Operations API's Central IAM session, CSRF and origin rules exactly as Staff and the Dashboard do.

## Authentication and session

- There is no local authentication, no B2B users or passwords table, no JWT and no third-party identity provider.
- The session is the API-owned opaque cookie (`__Host-arasya_session` in production, `arasya_session` in tests), set host-only on `api.arasyahome.ro` with `Secure`, `HttpOnly` and `SameSite=Lax`. JavaScript cannot read it.
- Every request is made by `src/api/client.ts` with `credentials: "include"` and `cache: "no-store"`. No `Authorization` header is ever sent.
- The CSRF token returned by `/auth/session`, `/auth/login` and `/auth/password` is kept in memory only and sent as `X-CSRF-Token` on mutations. It is forgotten on logout or session loss.
- No authentication or authorization data is written to `localStorage`, `sessionStorage`, IndexedDB or cookies. The only browser-storage entry is the interface language, `arasya.b2b.locale` (`ro` or `tr`). Unit and browser tests enforce this.

## Authorization

- The API decides. The frontend only chooses which screen to show: a pending password change first, then whether the session lists the `b2b` application, then the server gate `GET /b2b/access`.
- Authorization is not cached. While B2B is open it re-reads the session and the gate when the tab becomes visible and at least once a minute, and any request that returns `APPLICATION_ACCESS_DENIED`, `PASSWORD_CHANGE_REQUIRED`, `SESSION_EXPIRED` or `ACCOUNT_INACTIVE` re-reads the session immediately. Deactivation revokes the session on the server.
- The access-denied screen does not name permissions or internal identifiers. Server error text is never displayed; errors are shown from localized codes.

## Companies data (0.2.0)

- Company endpoints need the session, an active identity, `b2b.access` and a specific company permission (`b2b.companies.view`, `.create`, `.update` or `.manage_status`). Mutations also need the exact origin, the CSRF token and an `Idempotency-Key`. Hiding a button is a convenience; the server decides.
- Company, contact and address data and internal notes are kept in memory only while a page is open. They are never written to browser storage, never logged by the frontend, and never shown in error text.
- The Operations API exposes company data only through `/b2b/companies`. It is not part of Staff routes, production overviews, order lists or details, source health, `/health` or the IAM audit. Its activity history stores changed field names, never values.
- Company website links open with `rel="noopener noreferrer nofollow"`; the API accepts only http and https URLs.
- Validation and conflicts are neutral (required, invalid, duplicate tax identifier, concurrent change). There is no risk scoring or payment labelling.

## Origin and CORS

- The Operations API accepts credentialed requests only from the exact origins in `ARASYA_ALLOWED_ORIGINS`. Production lists `https://staff.arasyahome.ro`, `https://dashboard.arasyahome.ro` and `https://b2b.arasyahome.ro`; there is no wildcard and no subdomain pattern.
- Every mutation needs the exact `Origin` and a valid CSRF token. Look-alike origins (`https://b2b.arasyahome.ro.evil.example`, `http://b2b.arasyahome.ro`, other subdomains) are rejected; the Operations API unit, integration and B2B real-API tests cover this.

## Static hosting headers

`scripts/b2b-htaccess.template` is generated into `dist/.htaccess` at build time:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.arasyahome.ro; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'; worker-src 'none'`. The API origin is inserted only after validation as an exact HTTPS origin.
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment, usb, interest-cohort disabled) and `X-Robots-Tag: noindex, nofollow`.
- `Options -Indexes` (no directory listing), `SHA256SUMS` is not served, `index.html` and `release.json` are `no-store`, hashed assets are immutable.

The hosting provider injects `https://img1.wsimg.com/traffic-assets/js/tccl.min.js`. The CSP blocks it on purpose and it is not allowlisted; the resulting console message is expected.

## Build and release hygiene

- No source maps are published. `scripts/verify-build.mjs` fails the build if the bundle contains a loopback or development API address, a server secret name or a private key marker, or if the CSP is missing, widened or not bound to the configured API origin.
- Releases are checksummed (`SHA256SUMS`), carry their source commit in `release.json` and are validated again on the server before activation and before rollback.
- CI checks out the private Operations API with a repository-scoped, read-only deploy key (`STAFF_REPO_DEPLOY_KEY`), never with a personal token.

## Out of scope

B2B creates and mutates no production orders, sends nothing to Trendhome or any store, and does not change the inbound-only source rule of the Operations API. Companies V1 creates no B2B orders and holds no financial data.
