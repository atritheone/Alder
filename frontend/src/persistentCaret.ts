import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/** Draw outside the editable DOM so the cursor cannot affect text or navigation. */
export function persistentCaret() {
  return new Plugin({
    view(view) {
      const host = view.dom.parentElement!;
      const caret = document.createElement("span");
      caret.className = "write-caret";
      caret.setAttribute("aria-hidden", "true");
      host.append(caret);
      const update = (current: EditorView) => {
        caret.classList.toggle(
          "is-editing",
          current.hasFocus() && document.hasFocus(),
        );
        const selection = current.state.selection;
        let head = selection.head;
        let empty = selection instanceof TextSelection && selection.empty;
        // Native keyboard movement can arrive ahead of the editor transaction.
        const live = document.getSelection();
        if (
          document.activeElement === current.dom &&
          live?.anchorNode &&
          live.focusNode &&
          current.dom.contains(live.anchorNode) &&
          current.dom.contains(live.focusNode)
        ) {
          head = current.posAtDOM(live.focusNode, live.focusOffset);
          empty = live.isCollapsed;
        }
        caret.hidden = !empty;
        if (caret.hidden) return;
        const box = host.getBoundingClientRect();
        if (!box.width || !host.offsetWidth) return;
        const scale = box.width / host.offsetWidth;
        const point = current.coordsAtPos(head);
        caret.style.left = `${(point.left - box.left) / scale}px`;
        caret.style.top = `${(point.top - box.top) / scale}px`;
        caret.style.height = `${(point.bottom - point.top) / scale}px`;
      };
      const refresh = () => update(view);
      const observer = new ResizeObserver(refresh);
      observer.observe(host);
      view.dom.addEventListener("load", refresh, true);
      view.dom.addEventListener("keyup", refresh);
      view.dom.addEventListener("focus", refresh);
      view.dom.addEventListener("blur", refresh);
      window.addEventListener("focus", refresh);
      window.addEventListener("blur", refresh);
      view.dom.addEventListener("pointerup", refresh);
      document.fonts.addEventListener("loadingdone", refresh);
      document.addEventListener("selectionchange", refresh);
      update(view);
      return {
        update,
        destroy() {
          observer.disconnect();
          view.dom.removeEventListener("load", refresh, true);
          view.dom.removeEventListener("keyup", refresh);
          view.dom.removeEventListener("focus", refresh);
          view.dom.removeEventListener("blur", refresh);
          window.removeEventListener("focus", refresh);
          window.removeEventListener("blur", refresh);
          view.dom.removeEventListener("pointerup", refresh);
          document.fonts.removeEventListener("loadingdone", refresh);
          document.removeEventListener("selectionchange", refresh);
          caret.remove();
        },
      };
    },
  });
}
