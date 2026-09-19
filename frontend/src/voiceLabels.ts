/** User-facing language/accent labels; native locale codes remain identities. */
const accents: Record<string, string> = {
  en: "English",
  "en-us": "American",
  "en-gb": "English",
  "en-au": "Australian",
  "en-ca": "Canadian",
  "en-nz": "New Zealand",
  "en-ie": "Irish",
  "en-in": "Indian",
  "en-za": "South African",
  "en-gb-scotland": "Scottish",
  "en-gb-x-rp": "English · Received Pronunciation",
  "en-gb-x-gbclan": "Lancashire",
  "en-gb-x-gbcwmd": "West Midlands",
  "en-us-nyc": "American · New York",
  "fr-ca": "Canadian French",
  "pt-br": "Brazilian Portuguese",
  "es-mx": "Mexican Spanish",
  cmn: "Mandarin Chinese",
  yue: "Cantonese",
};
const names = new Intl.DisplayNames(["en"], { type: "language" });

export function voiceLanguageLabel(culture?: string): string {
  if (!culture) return "";
  const locale = culture.replaceAll("_", "-").toLowerCase();
  if (accents[locale]) return accents[locale];
  const region = locale.split("-").slice(0, 2).join("-");
  if (accents[region]) return accents[region];
  try {
    const label = names.of(locale);
    if (label && label.toLowerCase() !== locale) return label;
  } catch {
    /* An engine may use a nonstandard dialect identifier. */
  }
  const language = locale.split("-")[0];
  try {
    const label = names.of(language);
    if (label && label.toLowerCase() !== language) return label;
  } catch {
    /* Keep engine-specific codes out of the interface. */
  }
  return "Other language";
}
