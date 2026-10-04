import type { Messages } from "../i18n";

/**
 * Future B2B modules, in their planned order. They are only disabled placeholders: none has a route, a request or
 * any data behind it yet. Companies (0.2.0) is the first available module and is listed separately.
 */
export const PLANNED_MODULES: Array<keyof Messages["shell"]["modules"]> = ["dashboard", "orders", "accounts", "projects", "products", "reports"];
