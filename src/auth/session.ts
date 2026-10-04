import { ApiError, type B2bApi } from "../api/client";
import type { B2bAccess, Session } from "../api/types";
import { toProblem, type Problem } from "../i18n";

/** The Central IAM application key B2B is registered under. */
export const B2B_APPLICATION = "b2b";

export type AppState =
  | { kind: "loading" }
  | { kind: "unavailable"; problem: Problem }
  | { kind: "anonymous"; notice?: Problem }
  | { kind: "password"; session: Session }
  | { kind: "no-access"; session: Session }
  | { kind: "ready"; session: Session; access: B2bAccess };

/**
 * Decides what B2B may show for a central session. The API session is authoritative: a pending password change
 * blocks everything, and only an identity whose session lists the B2B application goes on to the server gate.
 * There is no frontend-only access flag.
 */
export function classifySession(session: Session | null, notice?: Problem): Exclude<AppState, { kind: "ready" | "loading" | "unavailable" }> | { kind: "needs-gate"; session: Session } {
  if (!session) return { kind: "anonymous", notice };
  if (session.employee.mustChangePassword) return { kind: "password", session };
  if (!session.employee.applications.includes(B2B_APPLICATION)) return { kind: "no-access", session };
  return { kind: "needs-gate", session };
}

/** Turns a central session into the next screen. B2B opens only after the server gate `GET /b2b/access` agrees. */
export async function resolveSession(api: B2bApi, session: Session | null, notice?: Problem): Promise<AppState> {
  const decision = classifySession(session, notice);
  if (decision.kind !== "needs-gate") return decision;
  try {
    return { kind: "ready", session: decision.session, access: await api.access() };
  } catch (error) {
    // Access may be removed between the session read and the gate.
    if (error instanceof ApiError && error.code === "APPLICATION_ACCESS_DENIED") return { kind: "no-access", session: decision.session };
    if (error instanceof ApiError && error.code === "PASSWORD_CHANGE_REQUIRED") return { kind: "password", session: decision.session };
    if (error instanceof ApiError && (error.code === "SESSION_EXPIRED" || error.code === "ACCOUNT_INACTIVE")) return { kind: "anonymous", notice: error };
    throw error;
  }
}

/** Restores the session from the API cookie; transport or server failures become a retryable screen. */
export async function restoreSession(api: B2bApi, notice?: Problem): Promise<AppState> {
  try {
    return await resolveSession(api, await api.getSession(), notice);
  } catch (error) {
    if (error instanceof ApiError && (error.code === "ACCOUNT_INACTIVE" || error.code === "SESSION_EXPIRED" || error.code === "NO_SESSION")) {
      return { kind: "anonymous", notice: error };
    }
    return { kind: "unavailable", problem: toProblem(error) };
  }
}
