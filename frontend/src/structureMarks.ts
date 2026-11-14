import type { Node } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/** Visual overlays only: never replace text or add characters to the document. */
export function structureMarks(enabled: () => boolean, whitespace = enabled) {
  type Mark = { from: number; to?: number; symbol: string; kind: string };
  const blocks = new WeakMap<Node, Mark[]>();
  const identities = new WeakMap<Node, number>();
  let nextIdentity = 0;
  let previousDoc: Node | undefined;
  let previousEnabled = false;
  let previousWhitespace = false;
  let from = 0, to = 8000, previousFrom = -1, previousTo = -1;
  let cached = DecorationSet.empty;
  return new Plugin({
    props: {
      decorations(state) {
        const visible = enabled();
        const showWhitespace = whitespace();
        if (state.doc === previousDoc && visible === previousEnabled && showWhitespace === previousWhitespace && from === previousFrom && to === previousTo)
          return cached;
        previousDoc = state.doc;
        previousEnabled = visible;
        previousWhitespace = showWhitespace;
        previousFrom = from; previousTo = to;
        if (!visible) return (cached = DecorationSet.empty);
        const marks: Decoration[] = [];
        const marker = (position: number, symbol: string, kind: string, key: string) => {
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
              { side: -1, key, ignoreSelection: true },
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
          if (!identities.has(node)) identities.set(node, ++nextIdentity);
          const identity = node.attrs.blockId || `node-${identities.get(node)}`;
          for (const mark of descriptions)
            if (mark.to == null)
              marker(position + mark.from, mark.symbol, mark.kind, `${identity}:${mark.kind === "paragraph" ? "paragraph" : mark.kind + mark.from}`);
            else if (showWhitespace && position + mark.from >= from && position + mark.from < to)
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
    view(view) {
      let frame = 0;
      const viewport = view.dom.closest(".editor-scroll");
      const measure = () => {
        frame = 0;
        if (!enabled() || !whitespace() || !viewport) return;
        const bounds = viewport.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const elements = [...view.dom.children].filter(element => !element.classList.contains("ProseMirror-widget"));
        if (elements.length !== view.state.doc.childCount) return;
        const offsets: number[] = [];
        view.state.doc.forEach((_node, pos) => offsets.push(pos));
        const boundary = (test: (element: Element) => boolean) => {
          let low = 0, high = elements.length;
          while (low < high) { const mid = (low + high) >>> 1; if (test(elements[mid])) low = mid + 1; else high = mid; }
          return low;
        };
        const first = boundary(element => element.getBoundingClientRect().bottom < bounds.top - 300);
        const last = boundary(element => element.getBoundingClientRect().top < bounds.bottom + 300);
        let nextFrom = offsets[first] ?? view.state.doc.content.size;
        let nextTo = offsets[last] ?? view.state.doc.content.size;
        // A very long paragraph/table must not expand the decoration budget to
        // the entire document. Hit testing locates the visible source window.
        if (nextTo - nextFrom > 20000) {
          const root = view.dom.getBoundingClientRect();
          const left = Math.max(root.left + 4, bounds.left + 24);
          const top = view.posAtCoords({ left, top: Math.max(root.top + 2, bounds.top + 8) })?.pos;
          const bottom = view.posAtCoords({ left, top: Math.min(root.bottom - 2, bounds.bottom - 8) })?.pos;
          nextFrom = Math.max(nextFrom, (top ?? view.state.selection.from) - 4000);
          nextTo = Math.min(nextTo, Math.max(nextFrom + 8000, (bottom ?? nextFrom) + 4000));
        }
        if (nextFrom === from && nextTo === to) return;
        from = nextFrom; to = nextTo;
        view.updateState(view.state);
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
      viewport?.addEventListener("scroll", schedule, { passive: true });
      const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
      if (viewport) resize?.observe(viewport);
      schedule();
      return { update: schedule, destroy() { cancelAnimationFrame(frame); resize?.disconnect(); viewport?.removeEventListener("scroll", schedule); } };
    },
  });
}
