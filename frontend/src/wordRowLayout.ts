import type { EditorView } from "prosemirror-view";
import type { FlowPage, PageLayout } from "./pageFlow";
import { pageAtY, pageFrame, documentCanvasWidth } from "./sectionLayout";
import { pageInsets } from "./pageGeometry";

/** Word clips a row taller than a sheet when cantSplit is set. Alder's keep-row
 * rule falls back to splitting oversized rows; carry that measured decision to
 * DOCX without guessing line wrapping from character counts or changing source. */
export function overflowingWordRows(
  view: EditorView,
  layout: PageLayout,
  pages: FlowPage[],
) {
  const canvas = view.dom.closest<HTMLElement>(".flow-canvas")!;
  const origin = canvas.getBoundingClientRect(),
    scale = origin.width / documentCanvasWidth(view.state.doc, layout);
  const ids: string[] = [];
  view.state.doc.descendants((node, pos) => {
    if (
      node.type.name !== "table_row" ||
      node.attrs.allowSplit ||
      !node.attrs.blockId
    )
      return;
    const element = view.nodeDOM(pos) as HTMLElement | null;
    if (!element) return;
    const rect = element.getBoundingClientRect(),
      page = Math.max(
        0,
        Math.min(
          pages.length - 1,
          pageAtY(pages, (rect.top - origin.top) / scale, layout),
        ),
      );
    const current = pageFrame(pages, page, layout).layout,
      inset = pageInsets(current);
    const available =
      pages[page].columnHeight || current.height - inset.top - inset.bottom;
    if (rect.height / scale > available + 0.5) ids.push(node.attrs.blockId);
  });
  return ids;
}

export function measuredTextBoxes(
  view: EditorView,
  layout: PageLayout,
  pages: FlowPage[],
) {
  const canvas = view.dom.closest<HTMLElement>(".flow-canvas")!;
  const origin = canvas.getBoundingClientRect(),
    scale = origin.width / documentCanvasWidth(view.state.doc, layout);
  const values: Record<string, { width: number; height: number }> = {};
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "text_box") return;
    const element = view.nodeDOM(pos) as HTMLElement,
      rect = element.getBoundingClientRect();
    const page = Math.max(
      0,
      Math.min(
        pages.length - 1,
        pageAtY(pages, (rect.top - origin.top) / scale, layout),
      ),
    );
    const current = pageFrame(pages, page, layout).layout,
      inset = pageInsets(current),
      available =
        pages[page].columnHeight || current.height - inset.top - inset.bottom;
    if (rect.height / scale > available + 0.5)
      throw new Error(
        "A text box is taller than its page. Make it wider or shorten its text before exporting.",
      );
    values[node.attrs.blockId] = {
      width: rect.width / scale,
      height: rect.height / scale,
    };
    return false;
  });
  return values;
}
