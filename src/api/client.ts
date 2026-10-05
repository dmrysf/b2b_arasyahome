import { ORDER_PERMISSIONS, mapCalculation, mapOrderDetail, mapOrderList, mapOrderMutation, type OrderFields, type OrderQuery, type LineInput, type Currency } from './orders';
import {
  mapActivity, mapCompanyDetail, mapCompanyList, mapMutation, COMPANY_PERMISSIONS,
  type AddressFields, type CompanyFields, type CompanyPermission, type ContactFields, type StatusFilter,
} from "./companies";
import {
  ACCOUNT_PERMISSIONS, mapAccountActivity, mapAccountMutation, mapAccountOverview, mapAccountSummary, mapMovementDetail, mapMovementPage, mapOpenItems, mapStatement,
  type AccountCurrency, type EntryInput, type MovementQuery, type OverviewQuery, type PaymentInput, type ReversalInput, type StatementQuery, type AllocationInput,
} from "./accounts";
import { ApiError } from "./errors";
import { PRODUCTION_PERMISSIONS, mapProduction } from './production';
import {
  PROJECT_PERMISSIONS, mapChangeResult, mapCommercial, mapProjectActivity, mapProjectDetail, mapProjectList, mapProjectMutation, mapProjectOrders, mapRoomDetail, mapScene,
  type ProjectFields, type ProjectOperation, type ProjectStatus,
} from './projects';
import type { B2bAccess, Session, SessionEmployee } from "./types";

export { ApiError } from "./errors";

/** Codes after which the app must treat the central session as gone. */
export const SESSION_CODES = new Set(["SESSION_EXPIRED", "NO_SESSION", "AUTHENTICATION_REQUIRED", "ACCOUNT_INACTIVE"]);
/** Codes after which the app must re-read the central session because authorization changed. */
export const ACCESS_CHANGED_CODES = new Set(["APPLICATION_ACCESS_DENIED", "PASSWORD_CHANGE_REQUIRED"]);

type Fetch = typeof fetch;
type Listener = (error: ApiError) => void;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("INVALID_RESPONSE", 502);
  return value as Record<string, unknown>;
}

/** Strict mapping of the central session; anything malformed fails closed. */
export function mapSessionEmployee(value: unknown): SessionEmployee {
  const raw = asObject(value);
  const text = (field: string) => { const v = raw[field]; if (typeof v !== "string" || !v) throw new ApiError("INVALID_RESPONSE", 502); return v; };
  const applications = raw.applications;
  if (!Array.isArray(applications) || applications.some((item) => typeof item !== "string")) throw new ApiError("INVALID_RESPONSE", 502);
  if (typeof raw.isRoot !== "boolean" || typeof raw.mustChangePassword !== "boolean" || typeof raw.authorizationVersion !== "number") throw new ApiError("INVALID_RESPONSE", 502);
  return {
    employeeUuid: text("employeeUuid"),
    displayName: text("displayName"),
    username: text("username"),
    applications: applications as string[],
    isRoot: raw.isRoot,
    mustChangePassword: raw.mustChangePassword,
    authorizationVersion: raw.authorizationVersion,
  };
}

function mapSession(value: unknown): Session & { csrfToken: string } {
  const raw = asObject(value);
  if (typeof raw.expiresAt !== "string" || typeof raw.csrfToken !== "string" || !raw.csrfToken) throw new ApiError("INVALID_RESPONSE", 502);
  return { employee: mapSessionEmployee(raw.employee), expiresAt: raw.expiresAt, csrfToken: raw.csrfToken };
}

function mapAccess(value: unknown): B2bAccess {
  const raw = asObject(value);
  const employee = asObject(raw.employee);
  if (raw.application !== "b2b" || typeof raw.authorizationVersion !== "number" || typeof employee.displayName !== "string" || typeof employee.username !== "string" || typeof employee.isRoot !== "boolean") {
    throw new ApiError("INVALID_RESPONSE", 502);
  }
  // Only known module permissions are kept; an older API without the field means "none".
  const permissions = Array.isArray(raw.permissions)
    ? [...COMPANY_PERMISSIONS, ...ORDER_PERMISSIONS, ...ACCOUNT_PERMISSIONS, ...PRODUCTION_PERMISSIONS, ...PROJECT_PERMISSIONS].filter((permission) => (raw.permissions as unknown[]).includes(permission))
    : [];
  return { application: "b2b", employee: { displayName: employee.displayName, username: employee.username, isRoot: employee.isRoot }, authorizationVersion: raw.authorizationVersion, permissions };
}

export type CompanyQuery = { search?: string; status?: StatusFilter; country?: string; cursor?: string | null; limit?: number };

/** One B2B mutation attempt. The same key is reused for a retry of the same change, so it is applied once. */
export type Idempotent = { idempotencyKey: string };

const segment = (id: string) => encodeURIComponent(id);
const statementParams = (query: StatementQuery) => {
  const params = new URLSearchParams({ currency: query.currency });
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return params.toString();
};

export type B2bApi = ReturnType<typeof createApi>;
export type { CompanyPermission };

/**
 * The only way B2B talks to the Operations API. Every request carries the API-owned HttpOnly session cookie
 * (`credentials: "include"`); the CSRF token is held in memory only and sent on mutations. Nothing is ever
 * written to browser storage.
 */
export function createApi(baseUrl: string, fetchImpl: Fetch = (...args) => fetch(...args)) {
  let csrfToken = "";
  const listeners = new Set<Listener>();

  async function request<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
    const method = init.method ?? "GET";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
    if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, baseUrl).toString(), { method, headers, credentials: "include", cache: "no-store", body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    } catch {
      throw new ApiError("NETWORK_UNAVAILABLE", 0);
    }
    let payload: unknown = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      const error = payload && typeof payload === "object" ? (payload as { error?: { code?: unknown; details?: unknown } }).error : undefined;
      const code = typeof error?.code === "string" ? error.code : response.status >= 500 ? "SERVER_ERROR" : "REQUEST_FAILED";
      const failure = new ApiError(code, response.status, undefined, error?.details);
      if (SESSION_CODES.has(code)) csrfToken = "";
      // The login, session and password calls report their own outcome; every other request tells the app.
      if (path !== "/auth/login" && path !== "/auth/session" && path !== "/auth/password" && (SESSION_CODES.has(code) || ACCESS_CHANGED_CODES.has(code))) {
        listeners.forEach((listener) => listener(failure));
      }
      throw failure;
    }
    if (payload === null) throw new ApiError("INVALID_RESPONSE", response.status);
    return payload as T;
  }

  /** A file download (statement CSV/PDF). Errors are read like any other request; the body is never parsed as JSON on success. */
  async function requestFile(path: string): Promise<Blob> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, baseUrl).toString(), { method: "GET", headers: { Accept: "text/csv, application/pdf, application/json" }, credentials: "include", cache: "no-store" });
    } catch {
      throw new ApiError("NETWORK_UNAVAILABLE", 0);
    }
    if (!response.ok) {
      let payload: unknown = null;
      try { payload = await response.json(); } catch { /* handled below */ }
      const error = payload && typeof payload === "object" ? (payload as { error?: { code?: unknown; details?: unknown } }).error : undefined;
      const code = typeof error?.code === "string" ? error.code : response.status >= 500 ? "SERVER_ERROR" : "REQUEST_FAILED";
      const failure = new ApiError(code, response.status, undefined, error?.details);
      if (SESSION_CODES.has(code)) csrfToken = "";
      if (SESSION_CODES.has(code) || ACCESS_CHANGED_CODES.has(code)) listeners.forEach((listener) => listener(failure));
      throw failure;
    }
    return response.blob();
  }

  const withSession = async (promise: Promise<unknown>): Promise<Session> => {
    const session = mapSession(await promise);
    csrfToken = session.csrfToken;
    return { employee: session.employee, expiresAt: session.expiresAt };
  };

  return {
    onSessionProblem(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** The current central session, or null when there is none. */
    async getSession(): Promise<Session | null> {
      try { return await withSession(request("/auth/session")); }
      catch (error) {
        if (error instanceof ApiError && (error.code === "NO_SESSION" || error.code === "SESSION_EXPIRED")) { csrfToken = ""; return null; }
        throw error;
      }
    },
    login: (username: string, password: string) => withSession(request("/auth/login", { method: "POST", body: { username, password } })),
    changePassword: (currentPassword: string, newPassword: string) => withSession(request("/auth/password", { method: "POST", body: { currentPassword, newPassword } })),
    async logout() {
      try { await request("/auth/logout", { method: "POST" }); }
      finally { csrfToken = ""; }
    },
    /** The server-side B2B gate; it fails with APPLICATION_ACCESS_DENIED once B2B access is removed. */
    access: async () => mapAccess(await request<unknown>("/b2b/access")),

    listOrders: async (query: OrderQuery = {}) => {
      const params = new URLSearchParams();
      if (query.companyId) params.set('companyId', query.companyId);
      if (query.search?.trim()) params.set('search', query.search.trim());
      if (query.status) params.set('status', query.status);
      if (query.limit) params.set('limit', String(query.limit));
      if (query.cursor) params.set('cursor', query.cursor);
      if (query.currency) params.set('currency', query.currency);
      if (query.from) params.set('from', query.from);
      if (query.to) params.set('to', query.to);
      return mapOrderList(await request(`/b2b/orders${params.size ? `?${params}` : ''}`));
    },
    getOrder: async (id: string) => mapOrderDetail(await request(`/b2b/orders/${segment(id)}`)),
    getProduction: async (id: string) => mapProduction(await request(`/b2b/orders/${segment(id)}/production`)),
    submitProduction: async (id: string, expectedVersion: number, { idempotencyKey }: Idempotent) => mapProduction(await request(`/b2b/orders/${segment(id)}/production`, { method: 'POST', body: { expectedVersion }, idempotencyKey })),
    /** The workshop sheet rendered by the server from the immutable manufacturing snapshot (no money). */
    productionSheetFile: (id: string, lang: "ro" | "tr") => requestFile(`/b2b/orders/${segment(id)}/production-sheet.pdf?lang=${lang}`),

    listProjects: async (query: { search?: string; status?: "open" | ProjectStatus | "all"; companyId?: string; cursor?: string | null } = {}) => {
      const params = new URLSearchParams();
      if (query.search?.trim()) params.set("search", query.search.trim());
      if (query.status) params.set("status", query.status);
      if (query.companyId) params.set("companyId", query.companyId);
      if (query.cursor) params.set("cursor", query.cursor);
      return mapProjectList(await request(`/b2b/projects${params.size ? `?${params}` : ""}`));
    },
    getProject: async (id: string) => mapProjectDetail(await request(`/b2b/projects/${segment(id)}`)),
    getProjectRoom: async (id: string, roomId: string) => mapRoomDetail(await request(`/b2b/projects/${segment(id)}/rooms/${segment(roomId)}`)),
    getProjectScene: async (id: string, roomId: string) => mapScene(await request(`/b2b/projects/${segment(id)}/scene?roomId=${segment(roomId)}`)),
    getProjectCommercial: async (id: string) => mapCommercial(await request(`/b2b/projects/${segment(id)}/commercial`)),
    getProjectOrders: async (id: string) => mapProjectOrders(await request(`/b2b/projects/${segment(id)}/orders`)),
    projectActivity: async (id: string, cursor?: string | null) => mapProjectActivity(await request(`/b2b/projects/${segment(id)}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)),
    createProject: async (fields: ProjectFields, { idempotencyKey }: Idempotent) => mapProjectMutation(await request("/b2b/projects", { method: "POST", body: fields, idempotencyKey })),
    updateProject: async (id: string, fields: ProjectFields, expectedVersion: number, { idempotencyKey }: Idempotent) =>
      mapProjectMutation(await request(`/b2b/projects/${segment(id)}`, { method: "PUT", body: { ...fields, expectedVersion }, idempotencyKey })),
    setProjectStatus: async (id: string, status: "active" | "archived", expectedVersion: number, { idempotencyKey }: Idempotent) =>
      mapProjectMutation(await request(`/b2b/projects/${segment(id)}/status`, { method: "POST", body: { status, expectedVersion }, idempotencyKey })),
    changeProject: async (id: string, operations: ProjectOperation[], { idempotencyKey }: Idempotent) =>
      mapChangeResult(await request(`/b2b/projects/${segment(id)}/changes`, { method: "POST", body: { operations }, idempotencyKey })),
    convertProject: async (id: string, treatmentIds: string[], expectedRevision: number, { idempotencyKey }: Idempotent) => {
      const r = await request<{ orderId?: unknown }>(`/b2b/projects/${segment(id)}/orders`, { method: "POST", body: { treatmentIds, expectedRevision }, idempotencyKey });
      if (typeof r.orderId !== "string") throw new ApiError("INVALID_RESPONSE", 502);
      return r.orderId;
    },
    proposalFile: (id: string, lang: "ro" | "tr") => requestFile(`/b2b/projects/${segment(id)}/proposal.pdf?lang=${lang}`),
    calculateOrder: async (fields: { currencyCode: Currency; lines: LineInput[] }) => mapCalculation(await request('/b2b/orders/calculate', {method:'POST',body:fields})),
    createOrder: async (fields: OrderFields, {idempotencyKey}: Idempotent) => mapOrderMutation(await request('/b2b/orders',{method:'POST',body:fields,idempotencyKey})),
    updateOrder: async (id: string, fields: OrderFields, expectedVersion: number, {idempotencyKey}: Idempotent) => mapOrderMutation(await request(`/b2b/orders/${segment(id)}`,{method:'PUT',body:{...fields,expectedVersion},idempotencyKey})),
    finalizeOrder: async (id: string, expectedVersion: number, {idempotencyKey}: Idempotent) => mapOrderMutation(await request(`/b2b/orders/${segment(id)}/finalize`,{method:'POST',body:{expectedVersion},idempotencyKey})),
    cancelOrder: async (id: string, expectedVersion: number, {idempotencyKey}: Idempotent) => mapOrderMutation(await request(`/b2b/orders/${segment(id)}/cancel`,{method:'POST',body:{expectedVersion},idempotencyKey})),
    createOrderLine: async (id: string, fields: LineInput, expectedVersion: number, {idempotencyKey}: Idempotent) => mapOrderMutation(await request(`/b2b/orders/${segment(id)}/lines`,{method:'POST',body:{...fields,id:null,expectedVersion},idempotencyKey})),
    updateOrderLine: async (id: string, lineId: string, fields: LineInput, expectedVersion: number, {idempotencyKey}: Idempotent) => mapOrderMutation(await request(`/b2b/orders/${segment(id)}/lines/${segment(lineId)}`,{method:'PUT',body:{...fields,expectedVersion},idempotencyKey})),
    duplicateOrderLine: async (id: string, lineId: string, expectedVersion: number, {idempotencyKey}: Idempotent) => mapOrderMutation(await request(`/b2b/orders/${segment(id)}/lines/${segment(lineId)}/duplicate`,{method:'POST',body:{expectedVersion},idempotencyKey})),
    removeOrderLine: async (id: string, lineId: string, expectedVersion: number, {idempotencyKey}: Idempotent) => mapOrderMutation(await request(`/b2b/orders/${segment(id)}/lines/${segment(lineId)}/remove`,{method:'POST',body:{expectedVersion},idempotencyKey})),
    reorderOrderLines: async (id: string, lineIds: string[], expectedVersion: number, {idempotencyKey}: Idempotent) => mapOrderMutation(await request(`/b2b/orders/${segment(id)}/lines/reorder`,{method:'POST',body:{lineIds,expectedVersion},idempotencyKey})),
    duplicateOrder: async (id: string, expectedVersion: number, {idempotencyKey}: Idempotent) => mapOrderMutation(await request(`/b2b/orders/${segment(id)}/duplicate`,{method:'POST',body:{expectedVersion},idempotencyKey})),
    orderActivity: async (id: string, cursor?: string|null) => mapActivity(await request(`/b2b/orders/${segment(id)}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)),

    accountsOverview: async (query: OverviewQuery = {}) => {
      const params = new URLSearchParams();
      if (query.search?.trim()) params.set("search", query.search.trim());
      if (query.status && query.status !== "all") params.set("status", query.status);
      if (query.balance && query.balance !== "all") params.set("balance", query.balance);
      if (query.cursor) params.set("cursor", query.cursor);
      if (query.limit) params.set("limit", String(query.limit));
      return mapAccountOverview(await request(`/b2b/accounts${params.size ? `?${params}` : ""}`));
    },
    accountSummary: async (companyId: string) => mapAccountSummary(await request(`/b2b/accounts/${segment(companyId)}`)),
    accountMovements: async (companyId: string, query: MovementQuery = {}) => {
      const params = new URLSearchParams();
      if (query.currency && query.currency !== "all") params.set("currency", query.currency);
      if (query.type && query.type !== "all") params.set("type", query.type);
      if (query.from) params.set("from", query.from);
      if (query.to) params.set("to", query.to);
      if (query.cursor) params.set("cursor", query.cursor);
      if (query.limit) params.set("limit", String(query.limit));
      return mapMovementPage(await request(`/b2b/accounts/${segment(companyId)}/movements${params.size ? `?${params}` : ""}`));
    },
    accountMovement: async (companyId: string, movementId: string) => mapMovementDetail(await request(`/b2b/accounts/${segment(companyId)}/movements/${segment(movementId)}`)),
    accountOpenItems: async (companyId: string, currency: AccountCurrency) => mapOpenItems(await request(`/b2b/accounts/${segment(companyId)}/open-items?currency=${currency}`)),
    accountStatement: async (companyId: string, query: StatementQuery) => mapStatement(await request(`/b2b/accounts/${segment(companyId)}/statement?${statementParams(query)}`)),
    accountActivity: async (companyId: string, cursor?: string | null) => mapAccountActivity(await request(`/b2b/accounts/${segment(companyId)}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)),
    /** The server renders the statement file from its own dataset; the browser only saves the bytes. */
    accountStatementFile: (companyId: string, format: "csv" | "pdf", query: StatementQuery & { lang: "ro" | "tr" }) =>
      requestFile(`/b2b/accounts/${segment(companyId)}/statement.${format}?${statementParams(query)}&lang=${query.lang}`),
    recordPayment: async (companyId: string, fields: PaymentInput, { idempotencyKey }: Idempotent) =>
      mapAccountMutation(await request(`/b2b/accounts/${segment(companyId)}/payments`, { method: "POST", body: fields, idempotencyKey })),
    allocatePayment: async (companyId: string, paymentId: string, allocations: AllocationInput[], { idempotencyKey }: Idempotent) =>
      mapAccountMutation(await request(`/b2b/accounts/${segment(companyId)}/allocations`, { method: "POST", body: { paymentId, allocations }, idempotencyKey })),
    releaseAllocation: async (companyId: string, allocationId: string, reason: string, { idempotencyKey }: Idempotent) =>
      mapAccountMutation(await request(`/b2b/accounts/${segment(companyId)}/allocations/${segment(allocationId)}/release`, { method: "POST", body: { reason }, idempotencyKey })),
    postOpeningBalance: async (companyId: string, fields: EntryInput, { idempotencyKey }: Idempotent) =>
      mapAccountMutation(await request(`/b2b/accounts/${segment(companyId)}/opening-balances`, { method: "POST", body: fields, idempotencyKey })),
    postAdjustment: async (companyId: string, fields: EntryInput, { idempotencyKey }: Idempotent) =>
      mapAccountMutation(await request(`/b2b/accounts/${segment(companyId)}/adjustments`, { method: "POST", body: fields, idempotencyKey })),
    reverseMovement: async (companyId: string, movementId: string, fields: ReversalInput, { idempotencyKey }: Idempotent) =>
      mapAccountMutation(await request(`/b2b/accounts/${segment(companyId)}/movements/${segment(movementId)}/reverse`, { method: "POST", body: fields, idempotencyKey })),

    listCompanies: async (query: CompanyQuery = {}) => {
      const params = new URLSearchParams();
      if (query.search?.trim()) params.set("search", query.search.trim());
      if (query.status) params.set("status", query.status);
      if (query.country) params.set("country", query.country);
      if (query.cursor) params.set("cursor", query.cursor);
      if (query.limit) params.set("limit", String(query.limit));
      const suffix = params.toString();
      return mapCompanyList(await request<unknown>(`/b2b/companies${suffix ? `?${suffix}` : ""}`));
    },
    getCompany: async (id: string) => mapCompanyDetail(await request<unknown>(`/b2b/companies/${segment(id)}`)),
    companyActivity: async (id: string, cursor?: string | null) =>
      mapActivity(await request<unknown>(`/b2b/companies/${segment(id)}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)),
    createCompany: async (fields: CompanyFields & { contact?: ContactFields | null; address?: AddressFields | null }, { idempotencyKey }: Idempotent) =>
      mapMutation(await request<unknown>("/b2b/companies", { method: "POST", body: fields, idempotencyKey })),
    updateCompany: async (id: string, fields: CompanyFields, expectedVersion: number, { idempotencyKey }: Idempotent) =>
      mapMutation(await request<unknown>(`/b2b/companies/${segment(id)}`, { method: "PUT", body: { ...fields, expectedVersion }, idempotencyKey })),
    setCompanyStatus: async (id: string, status: "active" | "inactive", expectedVersion: number, { idempotencyKey }: Idempotent) =>
      mapMutation(await request<unknown>(`/b2b/companies/${segment(id)}/${status === "active" ? "reactivate" : "deactivate"}`, { method: "POST", body: { expectedVersion }, idempotencyKey })),
    createContact: async (companyId: string, fields: ContactFields, { idempotencyKey }: Idempotent) =>
      mapMutation(await request<unknown>(`/b2b/companies/${segment(companyId)}/contacts`, { method: "POST", body: fields, idempotencyKey })),
    updateContact: async (companyId: string, contactId: string, fields: ContactFields, expectedVersion: number, { idempotencyKey }: Idempotent) =>
      mapMutation(await request<unknown>(`/b2b/companies/${segment(companyId)}/contacts/${segment(contactId)}`, { method: "PUT", body: { ...fields, expectedVersion }, idempotencyKey })),
    setContactStatus: async (companyId: string, contactId: string, status: "active" | "inactive", expectedVersion: number, { idempotencyKey }: Idempotent) =>
      mapMutation(await request<unknown>(`/b2b/companies/${segment(companyId)}/contacts/${segment(contactId)}/${status === "active" ? "reactivate" : "deactivate"}`, { method: "POST", body: { expectedVersion }, idempotencyKey })),
    createAddress: async (companyId: string, fields: AddressFields, { idempotencyKey }: Idempotent) =>
      mapMutation(await request<unknown>(`/b2b/companies/${segment(companyId)}/addresses`, { method: "POST", body: fields, idempotencyKey })),
    updateAddress: async (companyId: string, addressId: string, fields: AddressFields, expectedVersion: number, { idempotencyKey }: Idempotent) =>
      mapMutation(await request<unknown>(`/b2b/companies/${segment(companyId)}/addresses/${segment(addressId)}`, { method: "PUT", body: { ...fields, expectedVersion }, idempotencyKey })),
    setAddressStatus: async (companyId: string, addressId: string, status: "active" | "inactive", expectedVersion: number, { idempotencyKey }: Idempotent) =>
      mapMutation(await request<unknown>(`/b2b/companies/${segment(companyId)}/addresses/${segment(addressId)}/${status === "active" ? "reactivate" : "deactivate"}`, { method: "POST", body: { expectedVersion }, idempotencyKey })),
  };
}
