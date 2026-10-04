import type { Messages } from "../i18n";

/**
 * Future B2B modules, in their planned order. Foundation 0.1.0 shows them only as disabled placeholders: none has
 * a route, a request or any data behind it yet.
 */
export const PLANNED_MODULES: Array<keyof Messages["shell"]["modules"]> = ["dashboard", "companies", "orders", "accounts", "projects", "products", "reports"];
