import { it, expect } from "vitest";
import { EditorState, EditorSelection, StateField } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import {
  captureTextSessions,
  forgetTextSessions,
  registerTextSession,
  rememberTextSession,
  textEditorSession,
} from "./plainTextSessions";

it("keeps selection and undo while removing view-specific fields", () => {
  const field = StateField.define({
    create: () => ({ viewOnly: true }),
    update: (x) => x,
  });
  let state = EditorState.create({
    doc: "before",
    extensions: [history(), field],
  });
  state = state.update({
    changes: { from: 0, insert: "new " },
    selection: EditorSelection.cursor(4),
  }).state;
  rememberTextSession("p:write", state);
  let restored = textEditorSession("p:write")!;
  expect(restored.field(field, false)).toBeUndefined();
  expect(restored.selection.main.head).toBe(4);
  expect(
    undo({
      state: restored,
      dispatch: (tr) => {
        restored = tr.state;
      },
    }),
  ).toBe(true);
  expect(restored.doc.toString()).toBe("before");
  forgetTextSessions("p");
});
it("does not resurrect a closed document after delayed unmount", () => {
  const state = EditorState.create({ doc: "original" });
  const release = registerTextSession("closed", "closed:write", () => state);
  rememberTextSession("other:write", state);
  forgetTextSessions("closed");
  release(state);
  expect(textEditorSession("closed:write")).toBeUndefined();
  expect(textEditorSession("other:write")).toBeDefined();
  forgetTextSessions("other");
});
it("ignores cleanup from a replaced view", () => {
  const old = EditorState.create({ doc: "old" }),
    fresh = EditorState.create({ doc: "fresh" });
  const releaseOld = registerTextSession("p", "p:write", () => old);
  const releaseFresh = registerTextSession("p", "p:write", () => fresh);
  releaseOld(old);
  expect(captureTextSessions("p").get("p:write")?.doc.toString()).toBe("fresh");
  releaseFresh(fresh);
  forgetTextSessions("p");
});
