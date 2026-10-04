import { LOCALES, MESSAGES } from "../i18n";
import { useI18n } from "../i18n/context";

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">A</span>;
}

export function ErrorText({ error }: { error: unknown }) {
  const { problem } = useI18n();
  return <p className="form-error" role="alert">{problem(error)}</p>;
}

export function LocaleSwitcher() {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="locale-switch" role="group" aria-label={t.locale.switcher}>
      {LOCALES.map((code) => {
        const option = MESSAGES[code].locale;
        return (
          <button key={code} type="button" lang={code} aria-pressed={locale === code} aria-label={`${option.short} — ${option.name}`} title={option.name}
            onClick={() => setLocale(code)}>{option.short}</button>
        );
      })}
    </div>
  );
}
