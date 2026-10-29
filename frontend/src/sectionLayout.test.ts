import { describe, expect, it } from "vitest";
import { schema, parseEditorDocument } from "./Editor";
import { pageAtPosition, rearrangePages } from "./pageFlow";
import {
  documentCanvasWidth,
  pageAtY,
  pageCanvasHeight,
  pageFrame,
  sectionLayout,
  settingsForLayout,
  validSection,
} from "./sectionLayout";
import { documentText, projectText } from "./textProjection";

const base = { width: 800, height: 1100, margin: 80, zoom: 1, lineHeight: 1.5 };
const page = { pageSize: "A5", orientation: "landscape", marginMm: 15 };
const raw = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "First" }] },
    { type: "section_break", attrs: { kind: "oddPage", page } },
    { type: "paragraph", content: [{ type: "text", text: "Last" }] },
  ],
};
describe("section layout contract", () => {
  it('retains continuous boundaries as structural metadata rather than authored wording',()=>{
    const attrs={kind:'continuous',page};
    expect(validSection(attrs)).toBe(true);
    const parsed=parseEditorDocument({type:'doc',content:[raw.content[0],{type:'section_break',attrs},raw.content[2]]});
    expect(parsed.document?.child(1).attrs.kind).toBe('continuous');
    expect(parsed.document?.textContent).toBe('FirstLast');
  });
  it("keeps section breaks silent and stable in the narration projection", () => {
    const doc = schema.nodeFromJSON(raw);
    doc.check();
    expect(documentText(raw)).toBe("First\n\nLast");
    expect(projectText(doc).text).toBe(documentText(raw));
  });
  it("rejects nested sections without flattening the source", () => {
    expect(
      parseEditorDocument({
        type: "doc",
        content: [{ type: "blockquote", content: [raw.content[1]] }],
      }).document,
    ).toBeNull();
  });
  it.each([
    { kind: "column", page },
    { kind: "nextPage", page: { marginMm: 99, pageSize: "A5" } },
    { kind: "nextPage", page: { pageWidthMm: NaN } },
    { kind: "nextPage", page: { orientation: "sideways" } },
    { kind: "nextPage", page: { pageHeightMm: 1001 } },
  ])("rejects invalid geometry %j", (attrs) => {
    expect(validSection(attrs)).toBe(false);
    expect(
      parseEditorDocument({
        type: "doc",
        content: [{ type: "section_break", attrs }],
      }).document,
    ).toBeNull();
  });
  it("round-trips effective geometry without applying orientation twice", () => {
    const landscape = sectionLayout(base, page);
    const copy = sectionLayout(base, settingsForLayout(landscape));
    expect(copy.width).toBeCloseTo(landscape.width, 8);
    expect(copy.height).toBeCloseTo(landscape.height, 8);
    expect(copy.margins!.left).toBeCloseTo(landscape.margins!.left, 8);
    expect(documentCanvasWidth(schema.nodeFromJSON(raw), base)).toBe(800);
  });
  it("locates mixed pages and skips blank parity pages when navigating to text", () => {
    const frames = [
      {
        from: 0,
        to: 7,
        text: "First",
        frame: { top: 0, left: 0, layout: base },
      },
      { from: 7, to: 7, text: "", frame: { top: 1128, left: 0, layout: base } },
      {
        from: 7,
        to: 14,
        text: "Last",
        frame: { top: 2256, left: 0, layout: sectionLayout(base, page) },
      },
    ];
    expect(pageAtY(frames, 2300, base)).toBe(2);
    expect(pageAtPosition(frames, 7)).toBe(2);
    expect(pageCanvasHeight(frames, base)).toBeCloseTo(
      2256 + (148 * 96) / 25.4,
    );
    expect(pageFrame([], 0, base).top).toBe(0);
    expect(() =>
      rearrangePages(schema.nodeFromJSON(raw), frames, 0, 2),
    ).toThrow();
  });
  it("reorders pages within a section, retaining section boundaries, identities and geometry", () => {
    const paragraph = (text: string) =>
      schema.node("paragraph", { blockId: text }, schema.text(text));
    const boundary = schema.node("section_break", {
      blockId: "landscape",
      kind: "oddPage",
      page,
    });
    const doc = schema.node("doc", null, [
      paragraph("First"),
      boundary,
      paragraph("Middle"),
      schema.node("page_break"),
      paragraph("Last"),
    ]);
    const start = doc.child(0).nodeSize;
    const middle = start + boundary.nodeSize + doc.child(2).nodeSize;
    const pages = [
      { from: 0, to: start, text: "First" },
      { from: start, to: start, text: "" },
      { from: start, to: middle, text: "Middle" },
      { from: middle, to: doc.content.size, text: "Last" },
    ];
    const reordered = rearrangePages(doc, pages, 3, 2);
    expect(reordered.textContent).toBe("FirstLastMiddle");
    expect(reordered.child(0)).toBe(doc.child(0));
    expect(reordered.child(1)).toBe(boundary);
    expect(reordered.child(2).attrs.blockId).toBe("Last");
    expect(reordered.lastChild!.attrs.blockId).toBe("Middle");
    expect(() => rearrangePages(doc, pages, 0, 3)).toThrow(
      /within their section/,
    );
    expect(() => rearrangePages(doc, pages, 1, 2)).toThrow(
      /within their section/,
    );
  });
});
