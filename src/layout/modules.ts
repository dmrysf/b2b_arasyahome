import type { Messages } from "../i18n";

/**
 * Future B2B modules, in their planned order. They are only disabled placeholders: none has a route, a request or
 * any data behind it yet. Companies (0.2.0), Orders (0.3.0) and Current Accounts (0.4.0) are available and listed separately.
 */
export const PLANNED_MODULES: Array<keyof Messages["shell"]["modules"]> = ["dashboard", "projects", "products", "reports"];
