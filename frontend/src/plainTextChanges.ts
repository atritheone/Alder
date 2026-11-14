import type { ChangeSet, Text } from "@codemirror/state";
import type { DocNode } from "./types";
import { plainTextDocument } from "./plainTextTools";

/** Reconstruct touched lines while retaining every unaffected paragraph. */
export function changedPlainDocument(previous: DocNode | undefined, before: Text, after: Text, changes: ChangeSet): DocNode {
  if (!previous?.content || previous.content.length !== before.lines)
    return plainTextDocument(after.toString(), previous);
  const ranges: { a: number; endA: number; b: number; endB: number }[] = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const range = { a: before.lineAt(fromA).number - 1, endA: before.lineAt(toA).number,
      b: after.lineAt(fromB).number - 1, endB: after.lineAt(toB).number };
    const last = ranges.at(-1);
    if (last && last.endA >= range.a) { last.endA = range.endA; last.endB = range.endB; }
    else ranges.push(range);
  });
  const content: DocNode[] = []; let cursor = 0;
  for (const range of ranges) {
    for (; cursor < range.a; cursor++) content.push(previous.content[cursor]);
    for (let line = range.b; line < range.endB; line++) {
      const old = line - range.b < range.endA - range.a ? previous.content[range.a + line - range.b] : undefined;
      content.push(plainTextDocument(after.line(line + 1).text, old ? { type: "doc", content: [old] } : undefined).content![0]);
    }
    cursor = range.endA;
  }
  for (; cursor < previous.content.length; cursor++) content.push(previous.content[cursor]);
  return { type: "doc", content };
}
