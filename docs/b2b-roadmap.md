# B2B roadmap

Versions follow semantic versioning. The numbers below are the current plan, not a promise; a milestone may be split or renumbered when its scope becomes clearer.

| Version | Milestone | Scope |
|---|---|---|
| 0.1.0 | Foundation (released) | Central IAM application `b2b` and `b2b.access`, exact B2B origin in the Operations API, session states, RO/TR, application shell, CI with smoke and real-API suites, verified cPanel releases and rollback. No business functionality. |
| **0.2.0** | **Companies V1** (this release) | Wholesale companies with server UUIDs and `B2B-000001` codes, country + tax identifier uniqueness, multiple contacts and typed addresses with safe primaries, internal notes, deactivate/reactivate, optimistic concurrency, idempotency and immutable company activity. Data owned by the Operations API B2B module (API 2.8.0, migration 009); four narrow company permissions on top of `b2b.access`. Dashboard 0.5.1 localizes them. |
| 0.2.x | Companies follow-ups | Only what real use shows is needed (for example extra company attributes); never financial fields, which belong to the current account. |
| 0.3.x | Classic Order Builder | Orders reference `company_uuid` and snapshot company name, tax identifier, address and contact. Quick order form with manual product codes and snapshots (name, variant, colour), curtain and drapery lines, width, height, meters, quantity, unit price, discount and line total; `inventory_product_id` nullable. |
| 0.4.x | Current Account | Debit and credit tracking per company (`company_uuid`), payments, balances, payment terms and credit limits; no change to the company identity. |
| 0.5.x | Operations + Staff integration | Confirmed B2B orders enter the Operations API under the reserved source key `b2b` and run through `curtain-production@1` in Staff; B2B reads production progress from the API. |
| later | Visual Project Order Builder | Property type, floors, rooms, windows with individual dimensions and product codes; interactive zoom, pan and rotate; detailed single-window view; customer-facing presentation quality. |
| later | Premium 3D configurator | High-quality, fast 3D presentation built on the project structure above. |
| later | Inventory integration | Product codes resolve to the central Arasya inventory; existing snapshot-only lines stay valid. |

Rules that hold for every milestone:

- Central IAM stays the only identity system; B2B never stores users, passwords or tokens.
- The Operations API stays the only production truth; B2B never keeps a second production workflow.
- Trendhome and the other store integrations stay inbound-only.
