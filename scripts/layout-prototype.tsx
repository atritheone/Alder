// Bundled only by test-layout-prototype.mjs, never by the application build.
import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import Editor, { type EditorHandle } from "../frontend/src/Editor";
import { publicationHTML } from "../frontend/src/pagePublication";
import type { DocNode } from "../frontend/src/types";
import type { FlowPage } from "../frontend/src/pageFlow";
import { DOMSerializer } from "prosemirror-model";
import { schema } from "../frontend/src/Editor";
import { clipboardSlice } from "../frontend/src/pasteText";
import { identifiedDocument } from "../frontend/src/blockIdentities";

const paragraph = (text: string, attrs = {}): DocNode => ({
  type: "paragraph",
  attrs,
  content: [{ type: "text", text }],
});
const content: DocNode[] = [
  {
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: "Layout authority fixture" }],
  },
  paragraph(
    "This authored fixture measures the same line and page boundaries in editing and in a browser PDF. It includes long paragraphs, numbered lists and a merged table.",
  ),
  {
    type: "ordered_list",
    attrs: { order: 4 },
    content: ["First", "Second", "Third"].map((text) => ({
      type: "list_item",
      content: [paragraph(text)],
    })),
  },
  {
    type: "table",
    content: [
      {
        type: "table_row",
        content: [
          {
            type: "table_cell",
            attrs: { rowspan: 2, colwidth: [180] },
            content: [paragraph("Merged cell")],
          },
          {
            type: "table_cell",
            attrs: { colwidth: [260] },
            content: [paragraph("Upper cell")],
          },
        ],
      },
      {
        type: "table_row",
        content: [
          {
            type: "table_cell",
            attrs: { colwidth: [260] },
            content: [paragraph("Lower cell")],
          },
        ],
      },
    ],
  },
  paragraph(
    Array.from(
      { length: 360 },
      (_, i) =>
        `SPLIT${String(i).padStart(4, "0")} The wind moved through the branches.`,
    ).join(" "),
  ),
  { type: "page_break" },
  paragraph("EXPLICIT_BREAK_END"),
];
const document: DocNode = { type: "doc", content };
const host = window.document.createElement("div");
host.style.cssText =
  "position:fixed;inset:0;z-index:999999;display:flex;background:#dedede";
window.document.body.append(host);
function Prototype() {
  const editor = useRef<EditorHandle>(null);
  const [doc, setDoc] = useState(document);
  const [zoom, setZoom] = useState(1);
  const [scale, setScale] = useState(1);
  const [generation, setGeneration] = useState(0);
  const pages = useRef<FlowPage[] | null>(null);
  const operation = useRef<{ kind: string; start: number } | null>(null);
  const layoutTimings = useRef<
    { kind: string; milliseconds: number; pages: number }[]
  >([]);
  const snapshots = useRef<string[]>([]);
  const [capturePages, setCapturePages] = useState(false);
  const [pageSize, setPageSize] = useState({
    width: (210 * 96) / 25.4,
    height: (297 * 96) / 25.4,
    margin: (20 * 96) / 25.4,
  });
  host.style.zoom = String(scale);
  const api = {
    timings: () => layoutTimings.current,
    capture() {
      const started = performance.now();
      const publication = editor.current!.getPagePublication();
      return {
        html: publicationHTML(publication),
        pages: publication.pages.map(({ html: _, ...page }, index) => ({
          ...page,
          expectedTokens:
            pages.current?.[index]?.text.match(/SPLIT\d{4}/g) || [],
        })),
        milliseconds: performance.now() - started,
      };
    },
    capturePages: setCapturePages,
    snapshots: () => snapshots.current,
    navigate: (page: number) => editor.current!.navigatePage(page),
    moveUnit: (unit: any, destination: number) =>
      editor.current!.moveUnit(unit, destination),
    movePage: (from: number, to: number) => editor.current!.movePage(from, to),
    doc: () => doc,
    zoom: setZoom,
    scale: setScale,
    document: (value: DocNode) => {
      pages.current = null;
      setDoc(identifiedDocument(schema.nodeFromJSON(value)).toJSON());
    },
    fullLayout: () => {
      operation.current = { kind: "full", start: performance.now() };
      pages.current = null;
      setGeneration((value) => value + 1);
    },
    pages: () => {
      if (!pages.current) throw new Error("Layout pending");
      return pages.current;
    },
    edit: (start: number, end: number, text: string) => {
      operation.current = { kind: "edit", start: performance.now() };
      pages.current = null;
      editor.current!.replaceRange(start, end, text);
    },
    select: (start: number, end: number) => editor.current!.selectRange(start,end),
    clipboardRoundTrip: (value: DocNode, images?: Record<string, string>) => {
      const parsed = schema.nodeFromJSON(value);
      const container = window.document.createElement("div");
      container.append(
        DOMSerializer.fromSchema(schema).serializeFragment(parsed.content),
      );
      return clipboardSlice(
        schema,
        parsed.textContent,
        container.innerHTML,
        "source",
        undefined,
        undefined,
        images ? new Map(Object.entries(images)) : undefined,
      ).content.toJSON();
    },
    pageSize: setPageSize,
    text: () => editor.current!.getText(),
    highlight: (start: number, end: number) =>
      editor.current!.setReadingRange({ start, end }),
    page: (text: string) =>
      editor.current!.pageAtTextOffset(editor.current!.getText().indexOf(text)),
    append: () => editor.current!.insert(" appended"),
    reset: () => setDoc(document),
  };
  (window as any).__layoutProbe = api;
  return (
    <Editor
      key={generation}
      label="Text editor"
      ref={editor}
      document={doc}
      identity={`layout-prototype-${generation}`}
      projectId="prototype"
      assets={[]}
      fontFamily="Cambria"
      fontSize={16}
      styles={[]}
      showStructure={false}
      suppressChecks
      onToggleStructure={() => {}}
      onImage={() => {}}
      onLink={() => {}}
      onSelection={() => {}}
      onChange={setDoc}
      capturePages={capturePages}
      onPageSnapshots={(value) => {
        snapshots.current = value;
      }}
      onPages={(value) => {
        pages.current = value;
        if (operation.current) {
          layoutTimings.current.push({
            kind: operation.current.kind,
            milliseconds: performance.now() - operation.current.start,
            pages: value.length,
          });
          operation.current = null;
        }
      }}
      pageLayout={{
        ...pageSize,
        lineHeight: 1.5,
        zoom,
      }}
    />
  );
}
createRoot(host).render(<Prototype />);
