import { it, expect } from "vitest";
import { readShortcutMap, shortcutError } from "./textCommands";
it("validates bindings and rejects reserved/duplicate shortcuts", () => {
  expect(shortcutError("Ctrl-Alt-U", "upper", {})).toBeNull();
  expect(shortcutError("Ctrl-S", "upper", {})).toContain("reserved");
  expect(
    shortcutError("Mod-Alt-U", "lower", { upper: "Ctrl-Alt-U" }),
  ).toContain("already");
  expect(shortcutError("garbage", "upper", {})).toBeTruthy();
  expect(readShortcutMap('{"a":42,"b":"Ctrl-U"}')).toEqual({ b: "Ctrl-U" });
  expect(readShortcutMap("invalid")).toEqual({});
});
