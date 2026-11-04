const integers = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** UI counts use comma grouping independently of document language. */
export const formatInteger = (value: number) => integers.format(value);

/** Accept plain digits or correctly grouped commas in navigation fields. */
export function parseInteger(value: string) {
  const text = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return NaN;
  const result = Number(text.replaceAll(",", ""));
  return Number.isSafeInteger(result) ? result : NaN;
}
