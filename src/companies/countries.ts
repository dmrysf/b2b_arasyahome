import { INTL_LOCALE, type Locale } from "../i18n";

/** ISO 3166-1 alpha-2 codes accepted by the Operations API (src/B2B/CountryCodes.php). Names come from Intl. */
export const COUNTRY_CODES: readonly string[] = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE",
  "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD",
  "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM",
  "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN",
  "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME",
  "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM",
  "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI",
  "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK",
  "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
];

/** Shown first in country pickers: the markets Arasya sells to most. */
export const FREQUENT_COUNTRIES = ["RO", "TR", "MD", "BG", "HU", "DE", "IT", "FR", "AT", "PL", "GR"];

const displayNames = new Map<Locale, Intl.DisplayNames | null>();

/** The country name in the interface language; the stable code itself when the runtime cannot name it. */
export function countryName(code: string, locale: Locale): string {
  if (!displayNames.has(locale)) {
    try { displayNames.set(locale, new Intl.DisplayNames([INTL_LOCALE[locale]], { type: "region" })); }
    catch { displayNames.set(locale, null); }
  }
  try { return displayNames.get(locale)?.of(code) ?? code; } catch { return code; }
}

export type CountryOption = { code: string; name: string };

/** Frequent countries first, then every other code ordered by its localized name. */
export function countryOptions(locale: Locale): { frequent: CountryOption[]; others: CountryOption[] } {
  const collator = new Intl.Collator(INTL_LOCALE[locale]);
  const option = (code: string) => ({ code, name: countryName(code, locale) });
  return {
    frequent: FREQUENT_COUNTRIES.map(option),
    others: COUNTRY_CODES.filter((code) => !FREQUENT_COUNTRIES.includes(code)).map(option).sort((a, b) => collator.compare(a.name, b.name)),
  };
}
