# Security

B2B introduces no security model of its own. It uses the Operations API's Central IAM session, CSRF and origin rules exactly as Staff and the Dashboard do.

## Authentication and session

- There is no local authentication, no B2B users or passwords table, no JWT and no third-party identity provider.
- The session is the API-owned opaque cookie `arasya_session`, set host-only on `api.arasyahome.ro` with `Secure`, `HttpOnly` and `SameSite=Lax`. JavaScript cannot read it.
- Every request is made by `src/api/client.ts` with `credentials: "include"` and `cache: "no-store"`. No `Authorization` header is ever sent.
- The CSRF token returned by `/auth/session`, `/auth/login` and `/auth/password` is kept in memory only and sent as `X-CSRF-Token` on mutations. It is forgotten on logout or session loss.
- No authentication or authorization data is written to `localStorage`, `sessionStorage`, IndexedDB or cookies. The only browser-storage entry is the interface language, `arasya.b2b.locale` (`ro` or `tr`). Unit and browser tests enforce this.

## Authorization

- The API decides. The frontend only chooses which screen to show: a pending password change first, then whether the session lists the `b2b` application, then the server gate `GET /b2b/access`.
- Authorization is not cached. While B2B is open it re-reads the session and the gate when the tab becomes visible and at least once a minute, and any request that returns `APPLICATION_ACCESS_DENIED`, `PASSWORD_CHANGE_REQUIRED`, `SESSION_EXPIRED` or `ACCOUNT_INACTIVE` re-reads the session immediately. Deactivation revokes the session on the server.
- The access-denied screen does not name permissions or internal identifiers. Server error text is never displayed; errors are shown from localized codes.

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

## Out of scope for 0.1.0

B2B Foundation creates and mutates no production orders, sends nothing to Trendhome or any store, and does not change the inbound-only source rule of the Operations API.
