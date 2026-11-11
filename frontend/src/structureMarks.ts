import type { Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/** Visual overlays only: never replace text or add characters to the document. */
export function structureMarks(enabled: () => boolean) {
  type Mark = { from: number; to?: number; symbol: string; kind: string };
  const blocks = new WeakMap<Node, Mark[]>();
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
                element.dataset.kind = kind;
                element.dataset.symbol = symbol;
                element.setAttribute("aria-hidden", "true");
                return element;
              },
              { side: -1, key: `${kind}:${position}`, ignoreSelection: true },
            ),
          );
        };
        state.doc.descendants((node, position) => {
          if (!node.isTextblock) return;
          let descriptions = blocks.get(node);
          if (!descriptions) {
            descriptions = [];
            if (["paragraph", "heading"].includes(node.type.name))
              descriptions.push({
                from: node.nodeSize - 1,
                symbol: "¶",
                kind: "paragraph",
              });
            node.descendants((child, offset) => {
              const start = offset + 1;
              if (child.type.name === "hard_break")
                descriptions!.push({ from: start, symbol: "↵", kind: "break" });
              if (child.isText)
                for (const match of child.text!.matchAll(/[ \t\u00a0\n]/g)) {
                  const from = start + match.index!;
                  descriptions!.push({
                    from,
                    ...(match[0] === "\n" ? {} : { to: from + 1 }),
                    symbol:
                      match[0] === "\t"
                        ? "→"
                        : match[0] === "\u00a0"
                          ? "°"
                          : match[0] === "\n"
                            ? "↵"
                            : "·",
                    kind: "whitespace",
                  });
                }
            });
            blocks.set(node, descriptions);
          }
          for (const mark of descriptions)
            if (mark.to == null)
              marker(position + mark.from, mark.symbol, mark.kind);
            else
              marks.push(
                Decoration.inline(position + mark.from, position + mark.to, {
                  class:
                    mark.symbol === "→"
                      ? "structure-tab"
                      : "structure-whitespace",
                  "data-symbol": mark.symbol,
                }),
              );
          return false;
        });
        return (cached = DecorationSet.create(state.doc, marks));
      },
    },
  });
}
