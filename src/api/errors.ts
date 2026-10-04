/**
 * A typed API failure. `code` is the server error code; transport problems use NETWORK_UNAVAILABLE. `details` holds
 * the server's safe structured context (for example which fields failed validation), never display text.
 */
export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number, message?: string, public readonly details?: unknown) {
    super(message ?? code);
    this.name = "ApiError";
  }

  /** Field name to stable reason (required, too_long, invalid, inactive) from a VALIDATION_FAILED answer. */
  get fields(): Record<string, string> {
    const fields = this.details && typeof this.details === "object" ? (this.details as { fields?: unknown }).fields : undefined;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
    return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }
}
