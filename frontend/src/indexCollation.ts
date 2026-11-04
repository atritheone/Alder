export function validIndexLanguage(value?: string | null) {
  if (value == null) return true;
  if (typeof value !== "string" || value.length > 40 || !/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(value)) return false;
  try {
    return Intl.Collator.supportedLocalesOf(value).length === 1;
  } catch {
    return false;
  }
}

export function indexCollator(language?: string | null) {
  if (!validIndexLanguage(language)) throw new Error("Choose a supported index sorting language, such as en-GB or sv-SE.");
  return new Intl.Collator(language || "en", {
    usage: "sort", sensitivity: "variant", numeric: false,
    ignorePunctuation: false, caseFirst: "false",
  });
}
