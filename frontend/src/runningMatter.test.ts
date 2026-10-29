import { expect, it } from "vitest";
import {
  defaultRunningMatter,
  resolveRunningMatter,
  storyVariant,
  validRunningMatter,
  chapterRunningMatter,
  updateRunningStories,
} from "./runningMatter";
import { replaceProjectStyle, styleUsageCount } from "./styleResolution";
import { documentText } from "./textProjection";
import { hasPageReferences, updatePageReferences } from "./pageReferences";
import type { DocNode, Project } from "./types";
const story = (text: string): DocNode => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { styleId: "old" },
      content: [{ type: "text", text }],
    },
  ],
});
const project = () =>
  ({
    settings: {
      footer: true,
      runningMatter: {
        differentFirst: true,
        header: {
          default: story("Default"),
          first: story("First"),
          even: story("Even"),
        },
      },
    },
    styles: [
      { id: "old", name: "Old" },
      { id: "new", name: "New" },
    ],
    clips: [],
    placements: [],
    book: {
      chapters: [
        {
          id: "a",
          include: true,
          document: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Body" }] },
              {
                type: "section_break",
                attrs: {
                  blockId: "section",
                  runningMatter: { header: { default: null } },
                },
              },
            ],
          },
        },
        {
          id: "excluded",
          include: false,
          document: {
            type: "doc",
            content: [
              {
                type: "section_break",
                attrs: {
                  runningMatter: { header: { default: story("Excluded") } },
                },
              },
            ],
          },
        },
        { id: "b", document: { type: "doc", content: [] } },
      ],
    },
  }) as unknown as Project;
it("keeps explicit blank stories distinct from linked variants, with first-page precedence", () => {
  const p = project(),
    base = defaultRunningMatter(p.settings),
    before = JSON.stringify(base);
  const result = resolveRunningMatter(base, {
    differentEven: true,
    header: { default: null },
  });
  expect(result.header?.default).toBeNull();
  expect(documentText(result.header!.first!)).toBe("First");
  expect(JSON.stringify(base)).toBe(before);
  expect(storyVariant(result, 1, 1)).toBe("first");
  expect(storyVariant(result, 3, 1)).toBe("even");
  expect(storyVariant(result, 2, 1)).toBe("default");
  expect(documentText(p.book!.chapters[0].document)).toBe("Body\n");
  expect(chapterRunningMatter(p, "b")).toMatchObject({
    sectionId: "section",
    matter: { header: { default: null } },
  });
});
it("replaces named styles in all running stories and refreshes frozen stories too", () => {
  const p = project();
  p.placements = [
    {
      frozenDocument: {
        type: "doc",
        content: [
          {
            type: "section_break",
            attrs: { runningMatter: { footer: { default: story("Frozen") } } },
          },
        ],
      },
    },
  ] as unknown as Project["placements"];
  expect(styleUsageCount(p, "old")).toBe(5);
  replaceProjectStyle(p, "old", "new");
  expect(styleUsageCount(p, "old")).toBe(0);
  expect(styleUsageCount(p, "new")).toBe(5);
  updateRunningStories(p, (doc) => ({
    ...doc,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Refreshed" }] },
    ],
  }));
  expect(
    documentText(
      p.placements[0].frozenDocument!.content![0].attrs!.runningMatter.footer
        .default,
    ),
  ).toBe("Refreshed");
});
it("rejects malformed variants, distances, and unsupported recursive stories", () => {
  for (const value of [
    { differentFirst: 1 },
    { headerDistanceMm: NaN },
    { footerDistanceMm: 101 },
    { header: { other: null } },
    {
      header: {
        default: { type: "doc", content: [{ type: "section_break" }] },
      },
    },
  ])
    expect(validRunningMatter(value)).toBe(false);
  expect(validRunningMatter({ differentEven: true }, true)).toBe(false);
  expect(
    validRunningMatter({ header: { first: null, default: story("Valid") } }),
  ).toBe(true);
});

it("refreshes cached running totals without assigning one page number to a repeated story", () => {
  const p = project(),
    doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: ["page", "pageCount"].map((fieldKind) => ({
            type: "document_field",
            attrs: { fieldKind },
            content: [{ type: "text", text: "99" }],
          })),
        },
      ],
    };
  p.settings.runningMatter = { footer: { default: doc } };
  expect(hasPageReferences(p)).toBe(true);
  updatePageReferences(p, { pages: 12, references: {} });
  expect(
    p.settings.runningMatter.footer!.default!.content![0].content!.map(
      documentText,
    ),
  ).toEqual(["99", "12"]);
});
