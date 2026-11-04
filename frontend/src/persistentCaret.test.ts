// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { persistentCaret } from "./persistentCaret";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it("coalesces layout reads, paints the latest selection before the frame and cancels detached work", () => {
  const frames = new Map<number, FrameRequestCallback>(); let serial = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 125, height: 125 } as DOMRect);
  const schema = new Schema({ nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0] }, text: {} } });
  const view = new EditorView(document.body.appendChild(document.createElement("div")), {
    state: EditorState.create({ doc: schema.node("doc", null, schema.node("paragraph", null, schema.text("Some words."))), plugins: [persistentCaret()] }),
  });
  const coords = vi.spyOn(view, "coordsAtPos").mockImplementation(pos => ({ left: pos + 10, right: pos + 10, top: pos + 20, bottom: pos + 40 }));
  try {
    const measured = rect.mock.calls.length;
    for (const pos of [2, 3, 4]) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    expect(rect.mock.calls.length).toBe(measured);
    expect(coords).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
    expect(coords).toHaveBeenCalledExactlyOnceWith(4);
    const caret = document.querySelector<HTMLElement>(".write-caret")!;
    expect(caret.hidden).toBe(false);
    expect(caret.style.left).toBe("3.2px");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)));
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0));
    expect(caret.hidden).toBe(true);
    expect(coords).toHaveBeenCalledTimes(1);
    view.updateState(view.state); expect(frames.size).toBe(1);
  } finally { view.destroy(); }
  expect(frames.size).toBe(0);
  expect(document.querySelector(".write-caret")).toBeNull();
});
