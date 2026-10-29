import { type Schema } from "prosemirror-model";
import { renderRunningStory } from "./runningStoryLayout";
import type { DocNode, Project, NamedStyle } from "./types";
import type { PageLayout } from "./pageFlow";
import { pageInsets, screenPageGeometry } from "./pageGeometry";
import { formatPageNumber } from "./pageNumbering";
import { resolveStyles } from "./styleResolution";
import { documentFieldValues, type DocumentField } from "./documentFields";
import { documentText } from "./textProjection";
import { isHeadingField } from "./runningHeadings";

export const storyParts = ["header", "footer"] as const;
export const storyVariants = ["default", "first", "even"] as const;
export type StoryPart = (typeof storyParts)[number];
export type StoryVariant = (typeof storyVariants)[number];
export type RunningMatter = {
  differentFirst?: boolean;
  differentEven?: boolean;
  headerDistanceMm?: number;
  footerDistanceMm?: number;
  header?: Partial<Record<StoryVariant, DocNode | null>>;
  footer?: Partial<Record<StoryVariant, DocNode | null>>;
};
export const emptyStory = (): DocNode => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});
export function validStory(node: DocNode): boolean {
  return (
    ["doc", "paragraph", "text", "hard_break", "document_field"].includes(
      node.type,
    ) &&
    !node.attrs?.revisionProperties &&
    !node.attrs?.captionLabel &&
    (!node.marks ||
      node.marks.every((m) =>
        [
          "strong",
          "em",
          "underline",
          "strike",
          "subscript",
          "superscript",
          "text_style",
          "link",
        ].includes(m.type),
      )) &&
    (!node.content || node.content.every(validStory))
  );
}
export function validRunningMatter(
  value: unknown,
  section = false,
): value is RunningMatter {
  if (value == null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as RunningMatter;
  return Object.entries(v).every(([key, item]) => {
    if (key === "differentFirst" || (key === "differentEven" && !section))
      return typeof item === "boolean";
    if (key === "headerDistanceMm" || key === "footerDistanceMm")
      return (
        typeof item === "number" &&
        Number.isFinite(item) &&
        item >= 0 &&
        item <= 100
      );
    if (
      !storyParts.includes(key as StoryPart) ||
      !item ||
      typeof item !== "object" ||
      Array.isArray(item)
    )
      return false;
    return Object.entries(item).every(
      ([variant, doc]) =>
        storyVariants.includes(variant as StoryVariant) &&
        (doc === null ||
          (typeof doc === "object" && doc.type === "doc" && validStory(doc))),
    );
  });
}
export function resolveRunningMatter(
  previous: RunningMatter,
  local?: RunningMatter | null,
): RunningMatter {
  return {
    ...previous,
    ...local,
    header: { ...previous.header, ...local?.header },
    footer: { ...previous.footer, ...local?.footer },
  };
}
export function defaultRunningMatter(
  settings: Project["settings"],
): RunningMatter {
  const legacy: RunningMatter = {
    differentFirst: false,
    differentEven: false,
    headerDistanceMm: 10,
    footerDistanceMm: 10,
    header: {
      default: settings.header
        ? {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: settings.header }],
              },
            ],
          }
        : null,
    },
    footer: {
      default: settings.footer
        ? {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { align: "center" },
                content: [
                  {
                    type: "document_field",
                    attrs: { fieldKind: "page" },
                    content: [{ type: "text", text: "1" }],
                  },
                ],
              },
            ],
          }
        : null,
    },
  };
  return resolveRunningMatter(legacy, settings.runningMatter);
}
export function storyVariant(
  matter: RunningMatter,
  page: number,
  sectionStart = 0,
): StoryVariant {
  return matter.differentFirst && page === sectionStart
    ? "first"
    : matter.differentEven && page % 2 === 1
      ? "even"
      : "default";
}
export function storyDocuments(matter?: RunningMatter | null): DocNode[] {
  return storyParts.flatMap((part) =>
    Object.values(matter?.[part] || {}).filter((doc): doc is DocNode => !!doc),
  );
}
export function runningMatterDOM(
  layout: PageLayout,
  page: number,
  count: number,
  schema: Schema,
  styles: NamedStyle[] = [],
) {
  const result = document.createElement("div");
  result.className = "running-matter";
  result.style.cssText =
    "position:absolute;inset:0;pointer-events:none;user-select:none";
  const matter = layout.runningMatter;
  if (!matter) return result;
  const margins = pageInsets(layout),
    variant = storyVariant(matter, page, layout.sectionStartPage || 0),
    resolved = resolveStyles(styles);
  const fields: Partial<Record<DocumentField, string>> = {
    ...layout.runningHeadings,
    page: formatPageNumber(
      page + (layout.pageNumberOffset ?? layout.firstPageNumber ?? 1),
      layout.pageNumberFormat,
    ),
    pageCount: String(count),
  };
  const prepare = (node: DocNode): DocNode => {
    const attrs: Record<string, any> = {
      ...resolved.get(node.attrs?.styleId),
      ...Object.fromEntries(
        Object.entries(node.attrs || {}).filter(([, value]) => value != null),
      ),
    };
    const marks = node.marks?.map((m) =>
      m.type === "text_style"
        ? {
            ...m,
            attrs: {
              ...resolved.get(m.attrs?.styleId),
              ...Object.fromEntries(
                Object.entries(m.attrs || {}).filter(([, v]) => v != null),
              ),
            },
          }
        : m,
    );
    if (node.type === "document_field") {
      const value =
        fields[attrs.fieldKind as DocumentField] ??
        (isHeadingField(attrs.fieldKind) ? "—" : documentText(node) || "—");
      return {
        ...node,
        attrs: {
          ...attrs,
          unresolved: isHeadingField(attrs.fieldKind)
            ? fields[attrs.fieldKind] == null
            : attrs.unresolved,
        },
        content: value
          ? [
              {
                type: "text",
                text: value,
              },
            ]
          : [],
        marks,
      };
    }
    return {
      ...node,
      attrs:
        node.type === "paragraph"
          ? {
              fontSize: 9,
              lineHeight: 1.2,
              spaceBefore: 0,
              spaceAfter: 0,
              ...attrs,
            }
          : attrs,
      marks,
      content: node.content?.map(prepare),
    };
  };
  for (const part of storyParts) {
    const source = matter[part]?.[variant];
    if (!source) continue;
    const element = document.createElement("div");
    element.dataset.runningStory = part;
    element.dataset.runningVariant = variant;
    const distance =
      (part === "header" ? matter.headerDistanceMm : matter.footerDistanceMm) ??
      10;
    element.style.cssText = `position:absolute;left:${margins.left}px;width:${layout.width - margins.left - margins.right}px;${part === "header" ? "top" : "bottom"}:${(distance * 96) / 25.4}px;font-size:9pt;line-height:1.2;color:#555;white-space:pre-wrap;overflow-wrap:break-word;`;
    element.style.fontFamily = layout.fontFamily || "Cambria";
    renderRunningStory(element, schema.nodeFromJSON(prepare(source)));
    element.querySelectorAll<HTMLElement>("p").forEach((p) => {
      p.style.marginTop ||= "0";
      p.style.marginBottom ||= "0";
    });
    result.append(element);
  }
  return result;
}
export function runningFieldValues(project: Project) {
  return documentFieldValues(project);
}

export function updateRunningStories(
  project: Project,
  transform: (doc: DocNode) => DocNode,
) {
  const update = (matter?: RunningMatter | null) => {
    for (const part of storyParts)
      for (const variant of storyVariants) {
        const doc = matter?.[part]?.[variant];
        if (doc) matter![part]![variant] = transform(doc);
      }
  };
  update(project.settings?.runningMatter);
  const walk = (node: DocNode) => {
    if (node.type === "section_break") update(node.attrs?.runningMatter);
    node.content?.forEach(walk);
  };
  for (const chapter of project.book?.chapters || []) walk(chapter.document);
  for (const clip of project.clips || [])
    for (const item of [clip, ...(clip.variants || [])]) walk(item.document);
  for (const placement of project.placements || [])
    if (placement.frozenDocument) walk(placement.frozenDocument);
}

/** Resolve inherited stories at a chapter boundary without traversing prose. */
export function chapterRunningMatter(project: Project, chapterId: string) {
  let matter = defaultRunningMatter(project.settings),
    sectionId: string | undefined;
  for (const chapter of project.book?.chapters || []) {
    if (chapter.id === chapterId) break;
    if (chapter.include === false) continue;
    for (const node of chapter.document.content || [])
      if (node.type === "section_break") {
        matter = resolveRunningMatter(matter, node.attrs?.runningMatter);
        sectionId = node.attrs?.blockId;
      }
  }
  return { matter, sectionId };
}

export function runningMatterSignature(project: Project) {
  return JSON.stringify([
    project.settings,
    project.styles,
    project.book?.chapters.map((ch) => [
      ch.id,
      ch.include,
      ch.document.content?.filter((node) => node.type === "section_break"),
    ]),
  ]);
}

/** Refuse overlap rather than silently clipping authored running text. */
export function assertRunningMatterFits(
  layout: PageLayout,
  schema: Schema,
  styles: NamedStyle[] = [],
) {
  if (!layout.runningMatter) return;
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none;width:${layout.width}px;height:${layout.height}px;zoom:1`;
  document.body.append(host);
  try {
    const margin = pageInsets(layout);
    const variants: StoryVariant[] = [
      "default",
      ...(layout.runningMatter.differentFirst ? ["first" as const] : []),
      ...(layout.runningMatter.differentEven ? ["even" as const] : []),
    ];
    for (const variant of variants) {
      const selected: RunningMatter = {
        ...layout.runningMatter,
        differentFirst: false,
        differentEven: false,
        header: { default: layout.runningMatter.header?.[variant] },
        footer: { default: layout.runningMatter.footer?.[variant] },
      };
      host.replaceChildren(
        runningMatterDOM(
          { ...layout, runningMatter: selected },
          888,
          999,
          schema,
          styles,
        ),
      );
      for (const part of storyParts) {
        const element = host.querySelector<HTMLElement>(
          `[data-running-story=${part}]`,
        );
        if (!element) continue;
        const distance =
          ((selected[
            part === "header" ? "headerDistanceMm" : "footerDistanceMm"
          ] ?? 10) *
            96) /
          25.4;
        if (
          element.offsetHeight + distance + 4 >
          margin[part === "header" ? "top" : "bottom"]
        )
          throw new Error(
            `The ${variant === "default" ? "" : variant + " "}${part} needs more room. Increase the ${part === "header" ? "top" : "bottom"} page margin, reduce its distance from the edge, or shorten the text.`,
          );
      }
    }
  } finally {
    host.remove();
  }
}

export function assertProjectRunningMatterFits(
  project: Project,
  schema: Schema,
) {
  const settings = project.settings;
  let geometry = screenPageGeometry(settings),
    matter = defaultRunningMatter(settings);
  const check = () =>
    assertRunningMatterFits(
      {
        ...geometry,
        lineHeight: settings.lineHeight,
        zoom: 1,
        fontFamily: settings.fontFamily,
        runningMatter: matter,
      },
      schema,
      project.styles,
    );
  check();
  for (const chapter of project.book?.chapters || [])
    if (chapter.include !== false)
      for (const node of chapter.document.content || [])
        if (node.type === "section_break") {
          geometry = screenPageGeometry(node.attrs?.page || {});
          matter = resolveRunningMatter(matter, node.attrs?.runningMatter);
          check();
        }
}
