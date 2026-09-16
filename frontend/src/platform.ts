export function shortcutLabel(
  value: string,
  platform = typeof window !== "undefined" ? window.alder?.platform : undefined,
) {
  return platform === "darwin"
    ? value.replaceAll("Ctrl+", "⌘+").replaceAll("Alt+", "⌥+")
    : value;
}
