/** Add boundaries for a library word without doubling spaces or detaching punctuation. */
export function spacedWord(
  word: string,
  before: string,
  after: string,
): string {
  const text = word.trim();
  if (!text) return "";
  const leading =
    before && !/[\s([{"“‘—-]$/u.test(before) && !/^[,.;:!?)}\]’]/u.test(text)
      ? " "
      : "";
  const trailing =
    !/^[\s,.;:!?)}\]’]/u.test(after) && !/[([{“‘-]$/u.test(text) ? " " : "";
  return leading + text + trailing;
}
