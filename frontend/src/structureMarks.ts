import type { Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/** Visual overlays only: never replace text or add characters to the document. */
export function structureMarks(enabled: () => boolean) {
  let previousDoc: Node | undefined;
  let previousEnabled = false;
  let cached = DecorationSet.empty;
  return new Plugin({
    props: {
      decorations(state) {
        const visible = enabled();
        if (state.doc === previousDoc && visible === previousEnabled)
          return cached;
        previousDoc = state.doc;
        previousEnabled = visible;
        if (!visible) return (cached = DecorationSet.empty);
        const marks: Decoration[] = [];
        const marker = (position: number, symbol: string, kind: string) => {
          marks.push(
            Decoration.widget(
              position,
              (view) => {
                const element = view.dom.ownerDocument.createElement("span");
                element.className = "structure-marker";
                element.dataset.symbol = symbol;
                element.setAttribute("aria-hidden", "true");
                return element;
              },
              { side: -1, key: `${kind}:${position}`, ignoreSelection: true },
            ),
          );
        };
        state.doc.descendants((node, position) => {
          if (node.type.name === "paragraph" || node.type.name === "heading")
            marker(position + node.nodeSize - 1, "\u00b6", "paragraph");
          if (node.type.name === "hard_break")
            marker(position, "\u21b5", "break");
          if (node.isText) {
            for (const match of node.text!.matchAll(/[ \t\u00a0\n]/g)) {
              const from = position + match.index!;
              if (match[0] === "\n") marker(from, "\u21b5", "break");
              else
                marks.push(
                  Decoration.inline(from, from + 1, {
                    class: "structure-whitespace",
                    "data-symbol":
                      match[0] === "\t"
                        ? "\u2192"
                        : match[0] === "\u00a0"
                          ? "\u00b0"
                          : "\u00b7",
                  }),
                );
            }
          }
        });
        return (cached = DecorationSet.create(state.doc, marks));
      },
    },
  });
}
