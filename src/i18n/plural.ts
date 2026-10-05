/**
 * Counted nouns in the interface languages, chosen with the CLDR plural rules of each language.
 * Romanian: 1 produs · 2–19 produse · 20 de produse (and 101 produse, 120 de produse).
 * Turkish keeps the noun singular after a number: 1 ürün · 3 ürün.
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const rules = new Map<string, Intl.PluralRules>();

export function plural(locale: "ro" | "tr", count: number, forms: PluralForms): string {
  let rule = rules.get(locale);
  if (!rule) { rule = new Intl.PluralRules(locale); rules.set(locale, rule); }
  return (forms[rule.select(count)] ?? forms.other).replace("{n}", String(count));
}
