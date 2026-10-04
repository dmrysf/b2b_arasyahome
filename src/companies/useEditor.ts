import { useRef, useState } from "react";
import type { CompanyMutation } from "../api/companies";
import { ApiError } from "../api/errors";
import { toProblem, type Problem } from "../i18n";
import { serverFieldErrors, type FieldErrors } from "./forms";
import { Intent } from "./idempotency";

export type Conflict<D> = null | { phase: "pending" } | { phase: "rebased"; current: Partial<Record<keyof D, string | null>> } | { phase: "gone" };

type Options<D, F> = {
  initial: D;
  version: number;
  toFields: (draft: D) => F;
  check: (fields: F) => FieldErrors;
  save: (fields: F, expectedVersion: number, idempotencyKey: string) => Promise<CompanyMutation>;
  /** The stale-version code for this record (COMPANY_CHANGED, CONTACT_CHANGED or ADDRESS_CHANGED). */
  changedCode: string;
  /** The record as the server has it now, or null when it no longer exists. */
  loadCurrent: () => Promise<{ draft: D; version: number } | null>;
  /** The fields this form edits; after a conflict every other field is taken from the current version. */
  order: Array<keyof D>;
  /** How a current server value is shown next to a differing field. */
  display: (field: keyof D, draft: D) => string | null;
  onSaved: (result: CompanyMutation) => void;
};

/**
 * Editing with optimistic concurrency. A stale save never overwrites: the employee's draft stays in the form and
 * they can load the current version. Their own edits are kept, untouched fields take the current values, and every
 * edited field that now differs from the current version is shown with its current value. Saving again then uses
 * the current version. Retries of the same change reuse one Idempotency-Key.
 */
export function useEditor<D extends Record<string, unknown>, F>(options: Options<D, F>) {
  const [draft, setDraft] = useState<D>(options.initial);
  // The server version the draft started from; it tells the employee's own edits apart from untouched fields.
  const [base, setBase] = useState<D>(options.initial);
  const [version, setVersion] = useState(options.version);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Conflict<D>>(null);
  const intent = useRef(new Intent());

  const save = async () => {
    if (busy) return;
    const fields = options.toFields(draft);
    const local = options.check(fields);
    setErrors(local);
    setProblem(null);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    try {
      const result = await options.save(fields, version, intent.current.keyFor({ fields, version }));
      intent.current.done();
      setConflict(null);
      options.onSaved(result);
    } catch (error) {
      if (error instanceof ApiError && error.code === options.changedCode) {
        setConflict({ phase: "pending" });
      } else {
        setErrors(serverFieldErrors(error));
        setProblem(toProblem(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const loadCurrent = async () => {
    setBusy(true);
    try {
      const current = await options.loadCurrent();
      if (!current) {
        setConflict({ phase: "gone" });
        return;
      }
      // Drafts and request fields share their keys; compare what would be sent. Fields the employee edited keep
      // their value; untouched fields take the current version, so saving again never reverts someone else's change.
      const mine = options.toFields(draft) as Record<string, unknown>;
      const started = options.toFields(base) as Record<string, unknown>;
      const theirs = options.toFields(current.draft) as Record<string, unknown>;
      const edited = options.order.filter((field) => mine[field as string] !== started[field as string]);
      const differing = edited.filter((field) => mine[field as string] !== theirs[field as string]);
      setDraft({ ...current.draft, ...Object.fromEntries(edited.map((field) => [field, draft[field]])) } as D);
      setBase(current.draft);
      setVersion(current.version);
      setConflict({ phase: "rebased", current: Object.fromEntries(differing.map((field) => [field, options.display(field, current.draft)])) as Partial<Record<keyof D, string | null>> });
      setErrors({});
      setProblem(null);
    } catch (error) {
      setProblem(toProblem(error));
    } finally {
      setBusy(false);
    }
  };

  return { draft, setDraft, errors, problem, busy, conflict, save, loadCurrent };
}
