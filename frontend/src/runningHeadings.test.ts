import { expect, it } from "vitest";
import { EditorState } from "prosemirror-state";
import { schema } from "./Editor";
import {
  bodyHeading,
  chapterHeadingContext,
  headingIndex,
  withRunningHeadings,
} from "./runningHeadings";
import type { Project } from './types';
import {
  pageReferenceValues,
  pageReferenceTransaction,
} from "./pageReferences";
import type { PageLayout, FlowPage } from "./pageFlow";

const heading = (text: string, level = 1) =>
  schema.node("heading", { level }, text ? schema.text(text) : undefined);
const paragraph = () => schema.node("paragraph", null, schema.text("Body"));
const layout = {
  width: 800,
  height: 1100,
  margin: 70,
  gap: 28,
  zoom: 1,
  lineHeight: 1.5,
  runningMatter: {
    header: {
      default: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "document_field",
                attrs: { fieldKind: "heading1" },
                content: [{ type: "text", text: "Old" }],
              },
            ],
          },
        ],
      },
    },
  },
} as PageLayout;
it("uses the first heading on a page, the last on a previous page, then the first following one", () => {
  const nodes = [
    paragraph(),
    heading("Alpha"),
    heading("Beta"),
    heading("Detail", 2),
    paragraph(),
    heading("Gamma"),
    paragraph(),
  ];
  const doc = schema.node("doc", null, nodes),
    offsets = [0];
  nodes.forEach((n) => offsets.push(offsets[offsets.length - 1] + n.nodeSize));
  const pages = [0, 1, 4, 5, 6].map((at, i, starts) => ({
    from: offsets[at],
    to: offsets[starts[i + 1] ?? 7],
    text: "",
  }));
  const result = withRunningHeadings(doc, pages, layout);
  expect(result.map((p) => p.frame!.layout.runningHeadings!.heading1)).toEqual([
    "Alpha",
    "Alpha",
    "Beta",
    "Gamma",
    "Gamma",
  ]);
  expect(
    result.every((p) => p.frame!.layout.runningHeadings!.heading2 === "Detail"),
  ).toBe(true);
  expect(pages.every((p) => !("frame" in p))).toBe(true);
  expect(bodyHeading(doc, offsets[4], "heading1")).toBe("Beta");
  expect(bodyHeading(doc, 1, "heading1")).toBe("Alpha");
  expect(bodyHeading(doc, 1, "heading6")).toBeUndefined();
  expect(headingIndex(doc)).toBe(headingIndex(doc));
});
it("uses disjoint physical table ownership and does not renumber sections to find a heading", () => {
  const doc = schema.node("doc", null, [
    heading("Left"),
    paragraph(),
    heading("Right"),
  ]);
  const right = doc.child(0).nodeSize + doc.child(1).nodeSize;
  const pages: FlowPage[] = [
    {
      from: 0,
      to: doc.content.size,
      text: "",
      fragments: [
        { from: 0, to: 7 },
        { from: right, to: doc.content.size },
      ],
    },
    {
      from: 7,
      to: right,
      text: "",
      fragments: [{ from: 7, to: right }],
      frame: { top: 1200, left: 0, layout: { ...layout, firstPageNumber: 99 } },
    },
  ];
  expect(
    withRunningHeadings(doc, pages, layout).map(
      (p) => p.frame!.layout.runningHeadings!.heading1,
    ),
  ).toEqual(["Left", "Right"]);
});
it("resolves empty headings without retaining stale text and excludes recursive field values", () => {
  const field = schema.node(
    "document_field",
    { blockId: "field", fieldKind: "heading1" },
    schema.text("Old"),
  );
  const doc = schema.node("doc", null, [
    heading(""),
    schema.node("paragraph", null, field),
  ]);
  const state = EditorState.create({ doc }),
    pages = [{ from: 0, to: doc.content.size, text: "" }];
  const values = pageReferenceValues(doc, pages, layout);
  expect(values.fields?.field).toBe("");
  const updated = state.apply(pageReferenceTransaction(state, values)!);
  expect(updated.doc.lastChild!.firstChild!.textContent).toBe("");
  expect(updated.doc.lastChild!.firstChild!.attrs.unresolved).toBe(false);
  const recursive = schema.node("doc", null, [
    schema.node("heading", { level: 1 }, [schema.text("Name "), field]),
  ]);
  expect(bodyHeading(recursive, 3, "heading1")).toBe("Name");
});
it("does no heading projection when running stories do not use it", () => {
  const doc = schema.node("doc", null, [heading("Alpha")]),
    pages = [{ from: 0, to: doc.content.size, text: "" }];
  expect(
    withRunningHeadings(doc, pages, { ...layout, runningMatter: undefined }),
  ).toBe(pages);
});

it('inherits included chapter headings and gives a book chapter title its first-page position',()=>{
  const project={settings:{documentKind:'book'},book:{chapters:[
    {id:'a',title:'Earlier',document:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Prior detail'}]}]}},
    {id:'excluded',include:false,title:'Excluded',document:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Wrong'}]}]}},
    {id:'current',title:'Current chapter',document:{type:'doc',content:[]}},
    {id:'later',title:'Next chapter',document:{type:'doc',content:[{type:'heading',attrs:{level:3},content:[{type:'text',text:'Following detail'}]}]}},
  ]}} as unknown as Project;
  const context=chapterHeadingContext(project,'current');
  expect(context.before).toEqual({heading1:'Earlier',heading2:'Prior detail'});
  expect(context.after).toEqual({heading1:'Next chapter',heading3:'Following detail'});
  const doc=schema.node('doc',null,[heading('First body heading'),paragraph()]);
  const split=doc.firstChild!.nodeSize,pages=[{from:0,to:split,text:''},{from:split,to:doc.content.size,text:''}];
  const result=withRunningHeadings(doc,pages,{...layout,headingContext:context});
  expect(result.map(p=>p.frame!.layout.runningHeadings!.heading1)).toEqual(['Current chapter','First body heading']);
  expect(result.every(p=>p.frame!.layout.runningHeadings!.heading2==='Prior detail')).toBe(true);
  expect(result.every(p=>p.frame!.layout.runningHeadings!.heading3==='Following detail')).toBe(true);
  project.settings.documentKind='docx';
  expect(chapterHeadingContext(project,'current').title).toBeUndefined();
});
