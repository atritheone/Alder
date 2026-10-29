import { createRoot } from "react-dom/client";
import { useRef } from "react";
import Editor, { parseEditorDocument, type EditorHandle } from "./Editor";
import { screenPageGeometry } from "./pageGeometry";
import { publicationHTML } from "./pagePublication";
import { api } from "./api";
import { defaultRunningMatter, storyDocuments } from "./runningMatter";
import {
  loadDocumentFont,
  fontIsAvailable,
  type FontCatalogue,
} from "./fontCatalogue";
import type { DocNode, Project } from "./types";
import type { PageReferenceValues } from "./pageReferences";
import "./book-workspace.css";

export type PublicationInput = {
  name: string;
  sourceIdentity: string;
  projectId: string;
  document: DocNode;
  settings: Project["settings"];
  styles: Project["styles"];
};
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function readyImages(images: HTMLImageElement[], stage: string) {
  await Promise.all(
    images
      .filter((image) => image.hasAttribute("src"))
      .map(async (image) => {
        try {
          await image.decode();
        } catch {
          throw new Error(
            `A publication image could not be decoded during ${stage}: ${image.alt || "unnamed picture"}.`,
          );
        }
      }),
  );
}
let rendering = false;

/** The desktop owns this isolated window. It never opens a user editing
 * session, writes a project, or borrows the visible editor's selection. */
export async function renderPublication(input: PublicationInput) {
  if (rendering)
    throw new Error("This publication renderer is already in use.");
  rendering = true;
  document.title = input.name;
  const parsed = parseEditorDocument(input.document);
  if (!parsed.document)
    throw new Error(parsed.error || "Unsupported publication structure.");
  const fonts = await api<FontCatalogue>("/api/fonts");
  const families = new Set([input.settings.fontFamily || "Cambria"]);
  const collectStoryFonts = (node: DocNode) => {
    if (node.attrs?.fontFamily) families.add(node.attrs.fontFamily);
    for (const mark of node.marks || [])
      if (mark.attrs?.fontFamily) families.add(mark.attrs.fontFamily);
    node.content?.forEach(collectStoryFonts);
  };
  storyDocuments(input.settings.runningMatter).forEach(collectStoryFonts);
  parsed.document.descendants((node) => {
    storyDocuments(node.attrs.runningMatter).forEach(collectStoryFonts);
    if (node.attrs.fontFamily) families.add(node.attrs.fontFamily);
    for (const mark of node.marks)
      if (mark.attrs.fontFamily) families.add(mark.attrs.fontFamily);
  });
  await loadDocumentFont();
  const missingFonts = [...families].filter(
    (family) => !fontIsAvailable(family, fonts),
  );
  await Promise.all(missingFonts.map((family) => loadDocumentFont(family)));
  const host = document.getElementById("root")!;
  host.style.cssText = "height:100vh;width:100vw;display:flex;overflow:hidden";
  document.body.style.zoom = "1";
  const root = createRoot(host);
  let editor: EditorHandle | null = null;
  function Publication() {
    const ref = useRef<EditorHandle>(null);
    return (
      <Editor
        ref={(value) => {
          ref.current = value;
          editor = value;
        }}
        document={input.document}
        identity={`publication:${input.sourceIdentity}`}
        projectId={`publication:${input.sourceIdentity}`}
        assets={[]}
        styles={input.styles}
        fontFamily={input.settings.fontFamily}
        fontSize={(input.settings.fontSize * 96) / 72}
        showStructure={false}
        suppressChecks
        onChange={() => {}}
        onSelection={() => {}}
        onToggleStructure={() => {}}
        onImage={() => {}}
        onLink={() => {}}
        pageLayout={{
          ...screenPageGeometry(input.settings),
          zoom: 1,
          lineHeight: input.settings.lineHeight,
          header: input.settings.header,
          footer: input.settings.footer,
          runningMatter: input.settings.runningMatter
            ? defaultRunningMatter(input.settings)
            : undefined,
          runningStyles: input.styles,
          firstPageNumber: input.settings.firstPageNumber || 1,
          pageNumberFormat: input.settings.pageNumberFormat,
          fontFamily: input.settings.fontFamily,
        }}
      />
    );
  }
  root.render(<Publication />);
  const deadline = performance.now() + 90000;
  try {
    while (!editor && performance.now() < deadline) await frame();
    if (!editor) throw new Error("The publication editor could not start.");
    await document.fonts.ready;
    await readyImages([...host.querySelectorAll("img")], "page layout");
    await frame();
    await frame();
    let captured: ReturnType<EditorHandle["getPagePublication"]> | undefined;
    let referenceValues: PageReferenceValues | undefined,
      passes = 0;
    while (!captured && performance.now() < deadline) {
      try {
        captured = (editor as EditorHandle).getPagePublication();
        const resolved = (editor as EditorHandle).resolvePageReferences();
        referenceValues = resolved;
        if (resolved.changed) {
          captured = undefined;
          if (++passes > 12)
            throw new Error("Page-reference layout did not converge.");
          await frame();
        }
      } catch (cause) {
        if (passes > 12)
          throw new Error("Page-reference layout did not converge.");
        const message = cause instanceof Error ? cause.message : String(cause);
        if (
          !/^(Wait for the current document layout to finish\.|The document has not been paginated\.|The page geometry is unavailable\.)$/.test(
            message,
          )
        )
          throw cause;
        await frame();
      }
    }
    if (!captured)
      throw new Error(
        "Publication pagination did not finish. The authored document has not changed.",
      );
    const html = publicationHTML(captured);
    const pages = captured.pages.map(({ from, to, width, height }) => ({
      from,
      to,
      width,
      height,
    }));
    root.unmount();
    const printed = new DOMParser().parseFromString(html, "text/html");
    document.head.replaceChildren(...printed.head.childNodes);
    document.body.replaceChildren(...printed.body.childNodes);
    document.body.removeAttribute("style");
    await document.fonts.ready;
    await readyImages([...document.images], "PDF preparation");
    await frame();
    return {
      sourceIdentity: input.sourceIdentity,
      referenceValues,
      pages,
      warnings: missingFonts.map(
        (family) =>
          `${family} is unavailable on this computer; this PDF uses the bundled Liberation Serif fallback, matching Write.`,
      ),
    };
  } catch (cause) {
    root.unmount();
    throw new Error(
      cause instanceof Error || cause instanceof DOMException
        ? cause.message
        : String(cause),
    );
  }
}
