import { describe, it, expect } from "vitest";
import { chosenClip, collatedText, newClip, textDoc, words } from "./api";
import type { Project } from "./types";
const base = (): Project => ({
  id: "p",
  name: "Writing",
  revision: 1,
  schemaVersion: 1,
  createdAt: "",
  updatedAt: "",
  language: "en",
  tracks: [],
  clips: [],
  placements: [],
  sections: [
    { id: "s2", title: "Second", role: "chapter", order: 1 },
    { id: "s1", title: "First", role: "chapter", order: 0 },
  ],
  ideas: [],
  dictionary: [],
  pronunciation: [],
  styles: [],
  settings: {
    author: "",
    description: "",
    pageSize: "A4",
    marginMm: 22,
    fontFamily: "Georgia",
    fontSize: 12,
    lineHeight: 1.6,
    header: "",
    footer: true,
  },
  assets: [],
});
describe("language identity and collation", () => {
  it("keeps the original intact when choosing an alternate take", () => {
    const c = newClip("t", 0, "Original");
    c.variants.push({
      id: "v",
      name: "Alternative",
      text: "Chosen",
      document: textDoc("Chosen"),
      createdAt: "",
    });
    c.activeVariantId = "v";
    expect(chosenClip(c).text).toBe("Chosen");
    expect(c.text).toBe("Original");
  });
  it("orders by section then placement, respects exclusions and frozen text", () => {
    const p = base();
    const a = { ...newClip("t", 0, "Live original"), id: "a" },
      b = { ...newClip("t", 1, "Last"), id: "b" };
    a.variants = [
      {
        id: "v",
        name: "Take2",
        text: "Accepted",
        document: textDoc("Accepted"),
        createdAt: "",
      },
    ];
    a.activeVariantId = "v";
    p.clips = [a, b];
    p.placements = [
      {
        id: "2",
        clipId: "b",
        sectionId: "s2",
        order: 0,
        include: true,
        frozenText: null,
        frozenDocument: null,
      },
      {
        id: "1b",
        clipId: "a",
        sectionId: "s1",
        order: 1,
        include: true,
        frozenText: "Frozen quotation",
        frozenDocument: textDoc("Frozen quotation"),
      },
      {
        id: "1a",
        clipId: "a",
        sectionId: "s1",
        order: 0,
        include: true,
        frozenText: null,
        frozenDocument: null,
      },
      {
        id: "x",
        clipId: "b",
        sectionId: "s1",
        order: 2,
        include: false,
        frozenText: null,
        frozenDocument: null,
      },
    ];
    expect(collatedText(p)).toBe("Accepted\n\nFrozen quotation\n\nLast");
    expect(p.placements[0].id).toBe("2");
  });
  it("creates distinct editable identities and preserves empty paragraphs and Unicode", () => {
    const text = "I think.\n\nCafé — a new idea 🌱";
    const a = newClip("t", 0, text),
      b = newClip("t", 0, text);
    expect(a.id).not.toBe(b.id);
    expect(a.document.content).toHaveLength(3);
    expect(a.document.content?.[1].content).toEqual([]);
    expect(a.text).toBe(text);
    expect(words("   ")).toBe(0);
  });
});
