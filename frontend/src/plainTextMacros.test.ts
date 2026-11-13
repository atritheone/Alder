import { it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { prepareMacro, recordMacroStep } from "./plainTextMacros";

it("replays relative edits repeatedly as one composed transaction", async () => {
  const initial = EditorState.create({ doc: "abcd" }),
    tr = initial.update({
      changes: { from: 0, insert: "X" },
      selection: { anchor: 1 },
    });
  const step = recordMacroStep(tr)!;
  const result = await prepareMacro(initial, [step], 3);
  expect(initial.update(result).state.doc.toString()).toBe("XXXabcd");
});
it("refuses out of range edits and honours cancellation before applying", async () => {
  const state = EditorState.create({ doc: "a" }),
    step = {
      changes: [{ from: 0, to: 2, insert: "" }],
      ranges: [{ anchor: 0, head: 0 }],
      main: 0,
    };
  await expect(prepareMacro(state, [step], 1)).rejects.toThrow("outside");
  const signal = AbortSignal.abort();
  await expect(prepareMacro(state, [step], 1, signal)).rejects.toThrow(
    "cancelled",
  );
  expect(state.doc.toString()).toBe("a");
});
