export type TextCommand = { id: string; label: string; run: () => void };
export const normalizeShortcut = (key: string) =>
  key.replace(
    /-([A-Z])$/,
    (_all, letter: string) => "-" + letter.toLowerCase(),
  );
export function readShortcutMap(value: string): Record<string, string> {
  try {
    const data = JSON.parse(value);
    return data && typeof data === "object" && !Array.isArray(data)
      ? Object.fromEntries(
          Object.entries(data).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === "string" && entry[1].length <= 80,
          ),
        )
      : {};
  } catch {
    return {};
  }
}
export function shortcutError(
  key: string,
  command: string,
  bindings: Record<string, string>,
): string | null {
  if (!key) return null;
  if (/^[A-Za-z0-9]$/.test(key))
    return "Use Ctrl, Alt or Meta with a printable key.";
  if (
    !/^(?:(?:Mod|Ctrl|Alt|Shift|Meta)-)*(?:[A-Za-z0-9]|F(?:[1-9]|1[0-2])|Space|Enter|Tab|Home|End|Insert|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(
      key,
    )
  )
    return "Use a key such as Ctrl-Alt-U or Shift-F4.";
  const canonical = (text: string) =>
    text.toLowerCase().replace(/^mod-/, "ctrl-");
  if (
    [
      "ctrl-s",
      "ctrl-shift-s",
      "ctrl-o",
      "ctrl-n",
      "ctrl-w",
      "ctrl-f",
      "ctrl-p",
      "ctrl-tab",
      "alt-f4",
    ].includes(canonical(key))
  )
    return "That shortcut is reserved for an application command.";
  if (
    Object.entries(bindings).some(
      ([id, value]) => id !== command && canonical(value) === canonical(key),
    )
  )
    return "Another text command already uses that shortcut.";
  return null;
}
