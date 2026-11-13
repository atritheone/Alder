// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import PlainTextEditor from "./PlainTextEditor";
import type { EditorHandle } from "./Editor";
import { textDoc } from "./api";

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => {
  localStorage.clear();
});

async function mount(text: string) {
  const host = document.body.appendChild(document.createElement("div")),
    root = createRoot(host),
    ref = createRef<EditorHandle>();
  const changes: string[] = [];
  const props = {
    ref,
    identity: crypto.randomUUID(),
    projectId: "test",
    document: textDoc(text),
    assets: [],
    onChange: (_doc: unknown, value: string) => {
      changes.push(value);
    },
    onSelection: () => {},
    onFocus: () => {},
    showStructure: false,
    onToggleStructure: () => {},
    onImage: () => {},
    onLink: () => {},
  };
  await act(async () => root.render(createElement(PlainTextEditor, props)));
  const view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
  return {
    host,
    root,
    ref,
    changes,
    view,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("keeps UTF-16 selection/replacement offsets and speech code-point mappings consistent", async () => {
  const m = await mount("A😀 café\nsecond line");
  try {
    await act(async () => m.ref.current!.selectRange(1, 3));
    expect(m.ref.current!.getSelection()).toBe("😀");
    expect(m.ref.current!.getSpeechText(0, 0, false).text).toBe(
      "A😀 café\nsecond line",
    );
    expect(m.ref.current!.getSpeechText(9, 9, false).text).toBe("second line");
    expect(m.ref.current!.getSpeechText(0, 8, false)).toEqual({
      text: "A😀 café",
      offsets: [0, 1, 3, 4, 5, 6, 7, 8],
      endOffsets: [0, 1, 3, 4, 5, 6, 7, 8],
    });
    await act(async () => m.ref.current!.replace("X"));
    expect(m.changes.at(-1)).toBe("AX café\nsecond line");
  } finally {
    await m.close();
  }
});

it("refuses stale and overlapping replacement groups before changing text", async () => {
  const m = await mount("one two one");
  try {
    expect(() =>
      m.ref.current!.replaceMatches([{ start: 0, end: 3 }], "x", "old"),
    ).toThrow("changed");
    expect(() =>
      m.ref.current!.replaceMatches(
        [
          { start: 0, end: 3 },
          { start: 2, end: 4 },
        ],
        "x",
        "one two one",
      ),
    ).toThrow("Invalid");
    expect(m.ref.current!.getText()).toBe("one two one");
    await act(async () =>
      m.ref.current!.replaceMatches(
        [
          { start: 0, end: 3 },
          { start: 8, end: 11 },
        ],
        "x",
        "one two one",
      ),
    );
    expect(m.ref.current!.getText()).toBe("x two x");
    await act(async () => m.ref.current!.runMenuCommand("Undo"));
    expect(m.ref.current!.getText()).toBe("one two one");
  } finally {
    await m.close();
  }
});

it("replaces every cursor selection in a single operation", async () => {
  const m = await mount("a\nb");
  try {
    const { EditorSelection } = await import("@codemirror/state");
    await act(async () => {
      m.view.dispatch({
        selection: EditorSelection.create([
          EditorSelection.cursor(1),
          EditorSelection.cursor(3),
        ]),
      });
      m.ref.current!.insert("!");
    });
    expect(m.ref.current!.getText()).toBe("a!\nb!");
    expect(m.host.querySelectorAll(".cm-lineNumbers").length).toBe(1);
  } finally {
    await m.close();
  }
});

it("blocks all text transactions in read-only mode while retaining selection and reading navigation", async () => {
  const m = await mount("A😀 café\nsecond line");
  try {
    const input = Array.from(m.host.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("Read-only"))!
      .querySelector("input")!;
    await act(async () => input.click());
    expect(m.view.state.readOnly).toBe(true);
    await act(async () =>
      m.view.dispatch({ changes: { from: 0, insert: "unexpected" } }),
    );
    expect(m.ref.current!.getText()).toBe("A😀 café\nsecond line");
    expect(() => m.ref.current!.insert("x")).toThrow("read-only");
    await act(async () => m.ref.current!.selectRange(1, 3));
    expect(m.ref.current!.getSelection()).toBe("😀");
    await act(async () => m.ref.current!.setReadingRange({ start: 1, end: 3 }));
    expect(m.host.querySelector(".txt-reading")?.textContent).toBe("😀");
    await act(async () =>
      m.ref.current!.setReadingRange({ start: 999, end: 1000 }),
    );
    expect(m.host.querySelector(".txt-reading")).toBeNull();
  } finally {
    await m.close();
  }
});
