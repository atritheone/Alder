import { expect, it } from "vitest";
import { applyRulerTabEdit } from "./rulerTabs";
import type { TabStop } from "./tabStops";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { schema } from "./Editor";
import { paragraphTabs, selectionRulerTabs } from "./rulerTabs";
import { resolveStyles } from "./styleResolution";
import { setParagraph } from "./editorCommands";

const stop = (position: number, align: TabStop["align"] = "left"): TabStop => ({position, align, leader: "none"});
it("moves only the chosen stop in paragraphs with different tab lists", () => {
  const first = [stop(36), stop(72)];
  const second = [stop(36, "right"), stop(108)];
  const moved = [stop(48), stop(72)];
  expect(applyRulerTabEdit(second, first, moved)).toEqual([stop(48), stop(108)]);
  expect(second).toEqual([stop(36, "right"), stop(108)]);
});
it("removes only the targeted position and preserves unrelated or inherited stops", () => {
  expect(applyRulerTabEdit([stop(36), stop(108)], [stop(36), stop(72)], [stop(72)]))
    .toEqual([stop(108)]);
  expect(applyRulerTabEdit([stop(108)], [stop(36)], [])).toEqual([stop(108)]);
});
it("replaces a destination collision without duplicate positions", () => {
  expect(applyRulerTabEdit([stop(36), stop(72, "bar")], [stop(36)], [stop(72)]))
    .toEqual([stop(72)]);
});
it("keeps style inheritance intact after undoing a mixed-selection tab move", () => {
  const styles = [{id:"body",name:"Body",tabStops:[stop(36),stop(72)]}];
  const resolved = resolveStyles(styles);
  const doc = schema.node("doc",null,[
    schema.node("paragraph",{styleId:"body"},schema.text("First")),
    schema.node("paragraph",{tabStops:[stop(36,"right"),stop(108)]},schema.text("Second")),
  ]);
  let state = EditorState.create({doc,plugins:[history()],selection:TextSelection.create(doc,1,doc.content.size-1)});
  const before = selectionRulerTabs(state,styles);
  expect(before.mixed).toBe(true);
  const after = [stop(48),stop(72)];
  setParagraph(node=>({tabStops:applyRulerTabEdit(paragraphTabs(node,resolved),before.stops,after)}))(state,tr=>{state=state.apply(tr);});
  expect(state.doc.child(1).attrs.tabStops).toEqual([stop(48),stop(108)]);
  expect(undo(state,tr=>{state=state.apply(tr);})).toBe(true);
  expect(state.doc.eq(doc)).toBe(true);
  expect(state.doc.child(0).attrs.tabStops).toBeNull();
});
