// Date format and default units per locale (e.g. "en-US", "de-DE").
// Locale comes from SETUP.html (the browser's) or the System tab. '' = the Pi's system locale,
// which is what legacy used (Raspberry Pi OS defaults to en_GB: "21/11/2026, 20:42:05").

/** A valid BCP 47 locale tag, canonicalized, or '' if not usable. */
export function normalizeLocale(tag) {
  if (typeof tag !== 'string' || !tag.trim()) return '';
  try {
    return Intl.getCanonicalLocales(tag.trim())[0] ?? '';
  } catch {
    return '';
  }
}

/**
 * Date and time as the locale writes it (numeric, e.g. en-US "11/22/2026, 1:44:38 PM",
 * de-DE "22.11.2026, 13:44:38"). Always Latin digits so spreadsheets can read the log.
 */
export function formatDateTime(date, locale = '') {
  try {
    return date.toLocaleString(locale || undefined, { numberingSystem: 'latn' });
  } catch {
    return date.toLocaleString();
  }
}

// Countries that use Fahrenheit day to day (US + territories, and a few others).
const FAHRENHEIT_REGIONS = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH']);

/** '°F' or '°C' for a locale's country ('en' alone means en-US); undefined if unknown. */
export function temperatureUnitFor(locale) {
  const tag = normalizeLocale(locale);
  if (!tag) return undefined;
  try {
    const region = new Intl.Locale(tag).maximize().region;
    if (!region) return undefined;
    return FAHRENHEIT_REGIONS.has(region) ? '°F' : '°C';
  } catch {
    return undefined;
  }
}
