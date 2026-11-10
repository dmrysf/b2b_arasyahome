/** The part of the Central IAM session B2B relies on. Authorization itself is always decided by the API. */
export type SessionEmployee = {
  employeeUuid: string;
  displayName: string;
  username: string;
  applications: string[];
  isRoot: boolean;
  mustChangePassword: boolean;
  authorizationVersion: number;
};

export type Session = { employee: SessionEmployee; expiresAt: string };

import type { CompanyPermission } from "./companies";

/** GET /b2b/access: the server-side B2B application gate, with the module permissions usable right now. */
export type B2bFeatures = { orderTypes: boolean; financeGate: boolean };

export type B2bAccess = {
  application: "b2b";
  employee: { displayName: string; username: string; isRoot: boolean };
  authorizationVersion: number;
  /** API contract features (API 2.67.0: orderTypes, financeGate). An older API sends none: both false. */
  features: B2bFeatures;
  permissions: (CompanyPermission | import("./orders").OrderPermission | import("./accounts").AccountPermission | import("./production").ProductionPermission | import("./projects").ProjectPermission)[];
};
