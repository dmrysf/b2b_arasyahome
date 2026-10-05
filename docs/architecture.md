# Architecture

## Place in the Arasya platform

```
                    Central IAM (api.arasyahome.ro)
                         |
        +----------------+----------------+
        |                |                |
      Staff          Dashboard           B2B
                                           |
                              b2b.arasyahome.ro
```

Arasya B2B is a separate application with its own repository (`dmrysf/b2b_arasyahome`), build, release and document root. It shares no code at runtime with Staff or the Dashboard. It reuses their proven patterns (Vite, React, TypeScript, the API client shape, i18n, the release and cPanel tooling), not their source.

B2B is **not** an authentication system, a user or employee database, a production system, a WooCommerce or WordPress application.

## Central IAM relationship

`api.arasyahome.ro` (the Operations API, `dmrysf/staff_arasyahome/operations-api`) is the only identity provider. One person has one identity and one password for every Arasya application.

- B2B is registered in the Central IAM application registry as `b2b` with the access permission `b2b.access` (migration `008_b2b_application.sql`, Operations API 2.7.0). It uses exactly the same model as `staff` and `dashboard`: access is granted per person in `employee_application_access`, from the Dashboard, and `b2b.access` is never role-grantable. The model is ready for `finance.access` the same way.
- The protected root identity holds every active application, so root has B2B access without any B2B-specific rule. Root bootstrap and protection are unchanged.
- B2B access carries only `b2b.access` and `profile.view_self`. It grants no production, Staff or management permission; the API refuses those routes with `APPLICATION_ACCESS_DENIED`.
- The browser reads `GET /auth/session` (the same HttpOnly session as Staff and the Dashboard, because all three are the same site) and then the B2B gate `GET /b2b/access`. The gate is evaluated by the API on each call from the database, so a removed grant, a deactivation or a pending password change applies on the next call.

## Application separation

| Concern | Owner |
|---|---|
| Identities, passwords, sessions, roles, application access, IAM audit | Operations API (Central IAM) |
| Production truth: operational orders, the `curtain-production@1` workflow, stages, owners, activity | Operations API, operated through Staff and supervised in the Dashboard |
| Commerce status of Trendhome and OutletPerdele orders | The source stores; received inbound only |
| B2B user interface | This repository |
| Wholesale companies, contacts, addresses, notes and company activity (0.2.0) | Operations API B2B module (`operations-api/src/B2B`, migration 009), separate from production, Staff, sources and IAM internals |
| Commercial orders, line snapshots/pricing and order activity (0.3.0) | Operations API B2B module (migration 010), isolated from production; see [Classic Orders](classic-orders.md) |

B2B never keeps a copy of production state and never writes production data. Classic V1 finalization is commercial only; it sends nothing to Staff or source commerce.

## Companies V1 (0.2.0)

```
B2B frontend  ->  Operations API  ->  Central IAM (session, b2b.access, company permissions)
                                  ->  B2B company domain (b2b_companies, contacts, addresses, activity)
```

The company domain is the foundation every later module attaches to: the stable `company_uuid`, the immutable server-generated code, the fiscal identity (country + normalized tax identifier, unique), multiple contacts and typed addresses, internal notes and an immutable B2B activity history. Company endpoints need `b2b.access` plus a narrow role-grantable permission (`b2b.companies.view`, `.create`, `.update`, `.manage_status`). See [companies.md](companies.md).

## B2B domain (future)

Beyond Classic V1, future scope covers current accounts (debit/credit tracking) and payments, a visual project builder and inventory linkage. These are not implemented by 0.3.0.

Classic Orders V1 and company order history now exist in 0.3.0. Current accounts/payments, visual projects and catalog/inventory linkage remain future scope.

### Future manual order line

A manual order line will keep snapshots so a later catalogue change never rewrites a placed order:

| Field | Meaning |
|---|---|
| `product_code` | Code typed by the salesperson today; resolved from inventory later |
| `product_name_snapshot` | Product name as it was when the order was placed |
| `variant_snapshot` | Variant (for example heading type) at order time |
| `color_snapshot` | Colour at order time |
| `width`, `height` | Measurements |
| `meters` | Fabric meters |
| `quantity` | Pieces |
| `unit_price`, `discount`, `line_total` | Commercial values at order time |
| `inventory_product_id` | Nullable link to the future central inventory product |

This is documentation only; the schema will be designed in its own milestone. A B2B order will reference `company_uuid` and snapshot the company name, tax identifier, selected address and selected contact at order time, so later company edits never rewrite historical orders.

### Two order experiences

1. **Classic / Quick Order**: a fast form of order lines.
2. **Visual Project Order Builder**: the property type (house, villa, hotel, hospital, restaurant, office, cafe and others), its floors, rooms and windows, each window with its own dimensions, product codes and curtain or drapery selection; an interactive visual representation with zoom, pan, rotate and a detailed single-window view, fast enough and polished enough to present to customers. A premium 3D experience comes after that. No 3D library is installed.

## Future Operations integration

B2B orders will enter production through the existing platform, never through a second workflow:

```
B2B
 ↓
Operations API
 ↓
Staff
 ↓
curtain-production@1
```

The source key `b2b` is reserved for that integration. B2B will submit confirmed orders to the Operations API, which will create the operational order and run it through the canonical `curtain-production@1` workflow exactly like Trendhome and OutletPerdele orders. Staff remains where stages change, the Dashboard where production is supervised. B2B will read production progress from the Operations API instead of storing it. This integration is not implemented yet.

## Future inventory relationship

Today a product code will be typed manually. Later it will resolve to a product in a central Arasya inventory system. The order line therefore reserves a nullable `inventory_product_id`: lines placed before inventory exists stay valid with only their snapshots, and lines placed afterwards link to the inventory product while still keeping their snapshots. No inventory system or inventory API exists yet, and B2B will not invent one. The company domain is independent of inventory and never depends on it.
