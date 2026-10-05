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
export type B2bAccess = {
  application: "b2b";
  employee: { displayName: string; username: string; isRoot: boolean };
  authorizationVersion: number;
  permissions: (CompanyPermission | import("./orders").OrderPermission)[];
};
