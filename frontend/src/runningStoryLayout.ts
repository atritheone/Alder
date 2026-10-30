import { DOMSerializer, type Node as PMNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Plugin } from "prosemirror-state";
import { AlderTableView } from "./tableFormatting";
import { freezeTablesInCopy } from "./tableSnapshotLayout";
import { paintRunningImageSizes, runningImageVersion } from "./runningImages";
import { frozenHyphenation, hyphenationPaintVersion } from "./hyphenation";
import { outlineLists } from "./outlineLists";
import { normaliseListOrders } from "./listFormatting";
import { tabLayout, layoutTabs } from "./tabLayout";
import {
  exactLeading,
  layoutExactLeading,
  copyExactLeading,
} from "./exactLeading";

const cache = new Map<string, string>();
if (typeof document !== "undefined")
  document.fonts?.addEventListener("loadingdone", () => cache.clear());

/** Only tabs/exact leading need measurement. Repeated stories reuse frozen
 * paint; no editor, timers or mutation observers survive this operation. */
export function renderRunningStory(element: HTMLElement, doc: PMNode) {
  doc=normaliseListOrders(doc);
  let measured = false;
  doc.descendants((node) => {
    if (
      node.attrs.lineSpacingMode === "exact" ||
      node.type.name === "table" ||
      node.type.name === "ordered_list" ||
      node.type.name === "bullet_list" ||
      node.attrs.hyphenation ||
      (node.isText && node.text?.includes("\t"))
    )
      measured = true;
  });
  if (!measured) {
    element.append(
      DOMSerializer.fromSchema(doc.type.schema).serializeFragment(doc.content),
    );
    paintRunningImageSizes(element);
    return;
  }
  const key = JSON.stringify([
    doc.toJSON(),
    element.style.width,
    element.style.fontFamily,
    hyphenationPaintVersion,
    runningImageVersion,
  ]);
  const existing = cache.get(key);
  if (existing !== undefined) {
    element.innerHTML = existing;
    return;
  }
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none;width:${element.style.width};font-size:9pt;line-height:1.2;zoom:1`;
  host.style.fontFamily = element.style.fontFamily;
  document.body.append(host);
  const view = new EditorView(host, {
    state: EditorState.create({
      doc,
      plugins: [
        outlineLists(),
        new Plugin({
          props: { decorations: (state) => frozenHyphenation(state.doc) },
        }),
        tabLayout(() => true),
        exactLeading(
          () => [],
          () => true,
        ),
      ],
    }),
    editable: () => false,
    nodeViews: { table: (node) => new AlderTableView(node, 25) },
  });
  try {
    view.dom.dataset.runningStory = "measurement";
    view.dom.style.cssText =
      "padding:0;min-height:0;font-size:inherit;line-height:inherit";
    const imagesReady = paintRunningImageSizes(view.dom);
    layoutTabs(view, true);
    layoutExactLeading(view, true);
    const copy = view.dom.cloneNode(true) as HTMLElement;
    const source = [view.dom, ...view.dom.querySelectorAll("*")],
      target = [copy, ...copy.querySelectorAll("*")];
    source.forEach((node, index) => {
      const clone = target[index] as HTMLElement;
      if (node.classList.contains("discretionary-hyphen"))
        clone.dataset.printHyphen = String(
          node.getBoundingClientRect().width > 0.5,
        );
      copyExactLeading(node, clone);
      if (node.classList.contains("alder-tab")) {
        const css = getComputedStyle(node);
        for (const prop of [
          "display",
          "width",
          "white-space",
          "tab-size",
          "text-indent",
          "background-image",
          "background-size",
          "--alder-tab-leader-y",
        ])
          clone.style.setProperty(prop, css.getPropertyValue(prop));
      }
    });
    freezeTablesInCopy(view.dom, copy, 1);
    copy
      .querySelectorAll(".ProseMirror-separator")
      .forEach((node) => node.remove());
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    if (imagesReady) cache.set(key, copy.innerHTML);
    element.innerHTML = copy.innerHTML;
  } finally {
    view.destroy();
    host.remove();
  }
}
