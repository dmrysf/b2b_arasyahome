/** A fresh Idempotency-Key (the API accepts 16–100 characters from A-Z a-z 0-9 _ -). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * One user intent. Retrying the same change (double click, timeout, network retry) reuses its key, so the server
 * applies it once; changing the content starts a new intent, and a successful save ends it.
 */
export class Intent {
  private payload = "";
  private key = "";

  keyFor(payload: unknown): string {
    const serialized = JSON.stringify(payload);
    if (!this.key || serialized !== this.payload) {
      this.payload = serialized;
      this.key = newIdempotencyKey();
    }
    return this.key;
  }

  done(): void {
    this.payload = "";
    this.key = "";
  }
}
