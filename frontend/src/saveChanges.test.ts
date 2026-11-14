import { expect, it } from "vitest";
import { canonicalSaved } from "./saveChanges";
import type { Project } from "./types";
it("applies canonical insertions, replacements and removals without touching the request or unrelated branches", () => {
  const snapshot = {
    id: "p",
    revision: 1,
    book: {
      chapters: [{ text: "old", rawSource: "stale" }, { text: "unchanged" }],
    },
  } as unknown as Project;
  const saved = canonicalSaved(snapshot, {
    savedRevision: 2,
    changes: [
      { path: ["revision"], value: 2 },
      { path: ["updatedAt"], value: "now" },
      { path: ["book", "chapters", 0, "rawSource"], remove: true },
      { path: ["book", "chapters", 0, "text"], value: "canonical 🦉" },
    ],
  });
  expect(snapshot.revision).toBe(1);
  expect(snapshot.book!.chapters[0].text).toBe("old");
  expect(saved.book!.chapters[0].text).toBe("canonical 🦉");
  expect(saved.book!.chapters[0]).not.toHaveProperty("rawSource");
  expect(saved.book!.chapters[1]).toBe(snapshot.book!.chapters[1]);
  expect(canonicalSaved(snapshot, saved)).toBe(saved);
});
it("rejects invalid corrections and defines JSON keys without changing prototypes", () => {
  const snapshot = { id: "p", revision: 1 } as Project;
  expect(() =>
    canonicalSaved(snapshot, { savedRevision: 2, changes: [] }),
  ).toThrow("revision");
  expect(() =>
    canonicalSaved(snapshot, {
      savedRevision: 2,
      changes: [{ path: ["missing", "value"], value: 2 }],
    }),
  ).toThrow("parent");
  const saved = canonicalSaved(snapshot, {
    savedRevision: 2,
    changes: [
      { path: ["__proto__"], value: { polluted: true } },
      { path: ["revision"], value: 2 },
    ],
  });
  expect(Object.getPrototypeOf(saved)).toBe(Object.prototype);
  expect(({} as any).polluted).toBeUndefined();
});
