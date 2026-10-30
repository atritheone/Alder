import { it, expect } from "vitest";
import { schema } from "./Editor";
import { hyphenationWords, validHyphenation } from "./hyphenation";
import { resolveStyles } from "./styleResolution";
it("finds logical words across formatting but excludes links, code and inline objects", () => {
  const p = schema.node("paragraph", null, [
    schema.text("extra"),
    schema.text("ordinary", [schema.mark("em")]),
    schema.text(" hyperlink", [
      schema.mark("link", { href: "https://example.com" }),
    ]),
    schema.text(" exempt", [schema.mark("code")]),
    schema.node("hard_break"),
    schema.text("representation"),
  ]);
  expect(hyphenationWords(p)).toEqual([
    { from: 0, word: "extraordinary" },
    { from: 31, word: "representation" },
  ]);
  expect(hyphenationWords(p)).toBe(hyphenationWords(p));
});
it("retains explicit off and language inheritance", () => {
  const styles = resolveStyles([
    { id: "a", name: "A", hyphenation: true, textLanguage: "en-GB" },
    { id: "b", name: "B", basedOn: "a", hyphenation: false },
  ]);
  expect(styles.get("b")).toMatchObject({
    hyphenation: false,
    textLanguage: "en-GB",
  });
  expect(validHyphenation({ textLanguage: "en<script>" })).toBe(false);
  expect(validHyphenation({ hyphenation: "yes" })).toBe(false);
});
