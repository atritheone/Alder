import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { splitBlock } from "prosemirror-commands";
import { schema } from "./Editor";
import { identifiedDocument, blockIdentities } from "./blockIdentities";

describe("stable structural identities", () => {
  it("retains moved identities and gives copies fresh identities", () => {
    const a = schema.node(
      "paragraph",
      { blockId: "first" },
      schema.text("Alpha"),
    );
    const b = schema.node(
      "paragraph",
      { blockId: "second" },
      schema.text("Beta"),
    );
    const doc = identifiedDocument(schema.node("doc", null, [b, a, a]));
    expect(doc.child(0).attrs.blockId).toBe("second");
    expect(doc.child(1).attrs.blockId).toBe("first");
    expect(doc.child(2).attrs.blockId).not.toBe("first");
    expect(identifiedDocument(doc)).toBe(doc);
  });
  it("splits give the new half an identity and undo restores the original", () => {
    const doc = schema.node("doc", null, [
      schema.node(
        "paragraph",
        { blockId: "original" },
        schema.text("Alpha Beta"),
      ),
    ]);
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 6),
      plugins: [history(), blockIdentities()],
    });
    splitBlock(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.child(0).attrs.blockId).toBe("original");
    expect(state.doc.child(1).attrs.blockId).not.toBe("original");
    undo(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.eq(doc)).toBe(true);
  });
});
