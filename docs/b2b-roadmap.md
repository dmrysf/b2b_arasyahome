# B2B roadmap

Versions follow semantic versioning. The numbers below are the current plan, not a promise; a milestone may be split or renumbered when its scope becomes clearer.

| Version | Milestone | Scope |
|---|---|---|
| **0.1.0** | **Foundation** (this release) | Central IAM application `b2b` and `b2b.access`, exact B2B origin in the Operations API, session states, RO/TR, application shell, CI with smoke and real-API suites, verified cPanel releases and rollback. No business functionality. |
| 0.2.x | Companies / wholesale customers | Company records and profiles, contacts, company order history view. Data owned by a new Operations API B2B module, not by the browser. |
| 0.3.x | Classic Order Builder | Quick order form with manual product codes and snapshots (name, variant, colour), curtain and drapery lines, width, height, meters, quantity, unit price, discount and line total; `inventory_product_id` nullable. |
| 0.4.x | Current Account | Debit and credit tracking per company, payments, balances. |
| 0.5.x | Operations + Staff integration | Confirmed B2B orders enter the Operations API under the reserved source key `b2b` and run through `curtain-production@1` in Staff; B2B reads production progress from the API. |
| later | Visual Project Order Builder | Property type, floors, rooms, windows with individual dimensions and product codes; interactive zoom, pan and rotate; detailed single-window view; customer-facing presentation quality. |
| later | Premium 3D configurator | High-quality, fast 3D presentation built on the project structure above. |
| later | Inventory integration | Product codes resolve to the central Arasya inventory; existing snapshot-only lines stay valid. |

Rules that hold for every milestone:

- Central IAM stays the only identity system; B2B never stores users, passwords or tokens.
- The Operations API stays the only production truth; B2B never keeps a second production workflow.
- Trendhome and the other store integrations stay inbound-only.
