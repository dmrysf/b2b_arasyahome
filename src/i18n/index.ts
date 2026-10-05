import { ApiError } from "../api/client";
import type { StageId } from '../api/production';
import { stagesTr } from '../production/messages';
import { ro, type Messages } from "./ro";
import { readLocalePreference, writeLocalePreference, type LocaleStorage } from "./storage";
import { tr } from "./tr";

export type { Messages } from "./ro";

/** Interface languages. Romanian is the default and the fallback; the browser language is never used. */
export const LOCALES = ["ro", "tr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ro";

export const MESSAGES: Record<Locale, Messages> = { ro, tr };
export const INTL_LOCALE: Record<Locale, string> = { ro: "ro-RO", tr: "tr-TR" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The saved choice, or Romanian when nothing (or anything unexpected) is stored. */
export function initialLocale(storage?: LocaleStorage | null): Locale {
  const saved = readLocalePreference(storage);
  return isLocale(saved) ? saved : DEFAULT_LOCALE;
}

export function saveLocale(locale: Locale, storage?: LocaleStorage | null): void {
  writeLocalePreference(locale, storage);
}

export type ValidationKey = keyof Messages["validation"];

/** A form check that failed before anything was sent; rendered in the active language. */
export class ValidationProblem extends Error {
  constructor(public readonly key: ValidationKey) {
    super(key);
    this.name = "ValidationProblem";
  }
}

/**
 * Failures are kept as codes, not text, so an open error follows a language switch. Anything that is not a known
 * API or validation failure becomes a generic client error; its own message is never shown.
 */
export type Problem = ApiError | ValidationProblem;

export function toProblem(caught: unknown): Problem {
  return caught instanceof ApiError || caught instanceof ValidationProblem ? caught : new ApiError("CLIENT_ERROR", 0);
}

function pick<T>(map: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

export type Translator = {
  locale: Locale;
  t: Messages;
  /** Human message for a failure. Server text and stack traces are never shown. */
  problem: (error: unknown) => string;
  dateTime: (value: string | null) => string;
  stageLabel: (stage: { id: StageId; label: string }) => string;
};

export function createTranslator(locale: Locale): Translator {
  const t = MESSAGES[locale];
  const errors: Record<string, string> = t.errors;
  const dateTime = new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Bucharest" });
  return {
    locale,
    t,
    stageLabel: (stage) => ({ ro: stage.label, tr: stagesTr[stage.id] })[locale],
    problem: (error) => {
      if (error instanceof ValidationProblem) return t.validation[error.key];
      if (error instanceof ApiError) return pick(errors, error.code) ?? (error.status === 403 ? t.errors.UNAUTHORIZED_ACTION : t.errors.fallback);
      return t.errors.fallback;
    },
    dateTime: (value) => {
      if (!value) return "—";
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? "—" : dateTime.format(parsed);
    },
  };
}
