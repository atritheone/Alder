import { Fragment, type Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";

export type ArrangementUnit = {
  kind: "paragraph" | "sentence";
  from: number;
  to: number;
  text: string;
  originFrom?: number;
  originTo?: number;
};
export function documentUnits(doc: PMNode): ArrangementUnit[] {
  const units: ArrangementUnit[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  type Block = { node: PMNode; pos: number };
  const groups: Block[][] = [];
  const runs: Block[][] = [];
  let run: Block[] = [];
  const flush = () => {
    // Legacy plain-text imports stored hard-wrapped prose as one block per
    // source line. Recognise only blank-delimited, consistently short runs
    // whose internal lines mostly end mid-sentence. Do not rewrite the doc.
    if (run.length) runs.push(run);
    run = [];
  };
  const isWrapped = (run: Block[], minimum: number) => {
    const lengths = run.map(({ node }) => node.textContent.trim().length);
    const unfinished = run
      .slice(0, -1)
      .filter(
        ({ node }) => !/[.!?:;]["'”’\])]*$/.test(node.textContent.trim()),
      ).length;
    return (
      run.length >= minimum &&
      lengths.every((n) => n <= 120) &&
      lengths.filter((n) => n >= 40).length >= minimum - 1 &&
      unfinished >= (run.length - 1) * 0.7
    );
  };
  doc.descendants((node, pos, parent) => {
    if (node.type.name === "table_of_contents") { flush(); return false; }
    if (!node.isTextblock) {
      flush();
      return;
    }
    if (
      node.type.name === "paragraph" &&
      node.textContent.trim() &&
      parent === doc
    ) {
      if (
        run.length &&
        (run.at(-1)!.pos + run.at(-1)!.node.nodeSize !== pos ||
          !run[0].node.hasMarkup(
            node.type,
            {
              ...node.attrs,
              // Block identity is not formatting. Legacy wrapped paragraphs
              // still form one unit after receiving stable schema identities.
              ...("blockId" in run[0].node.attrs
                ? { blockId: run[0].node.attrs.blockId }
                : {}),
            },
            node.marks,
          ))
      )
        flush();
      run.push({ node, pos });
    } else {
      flush();
      runs.push([{ node, pos }]);
    }
    return false;
  });
  flush();
  for (const run of runs) {
    if (isWrapped(run, 2)) groups.push(run);
    else groups.push(...run.map((block) => [block]));
  }
  for (const group of groups) {
    let text = "";
    const positions: number[] = [];
    const ends: number[] = [];
    for (const { node, pos } of group) {
      if (text) {
        positions.push(pos - 1);
        ends.push(pos);
        text += " ";
      }
      let pendingBookmark: number | null = null;
      node.forEach((child, offset) => {
        const at = pos + 1 + offset;
        if (
          child.type.name === "bookmark_end" ||
          (child.type.name === "comment_anchor" && child.attrs.edge === "end")
        ) {
          if (ends.length) ends[ends.length - 1] = at + 1;
          return;
        }
        if (
          child.type.name === "bookmark" ||
          (child.type.name === "comment_anchor" && child.attrs.edge === "start")
        ) {
          pendingBookmark ??= at;
          return;
        }
        const reference = [
          "cross_reference",
          "sequence",
          "document_field",
        ].includes(child.type.name);
        const part = child.isText
          ? child.text!
          : reference
            ? child.textContent
            : "\ufffc";
        for (let i = 0; i < part.length; i++) {
          positions.push(
            i === 0 ? (pendingBookmark ?? at) : reference ? at : at + i,
          );
          ends.push(reference ? at + child.nodeSize : at + i + 1);
        }
        pendingBookmark = null;
        text += part;
      });
    }
    units.push({
      kind: "paragraph",
      from: group[0].pos,
      to: group.at(-1)!.pos + group.at(-1)!.node.nodeSize,
      text,
    });
    let sentenceStart = 0;
    for (const segment of segmenter.segment(text)) {
      const trim = segment.segment.trim();
      if (!trim) continue;
      const start = segment.index + segment.segment.indexOf(trim);
      const previous = units.at(-1);
      // An atomic generated passage may itself contain several sentences.
      // Never expose overlapping handles that could split or duplicate it.
      if (previous?.kind === "sentence" && previous.to > positions[start]) {
        previous.to = Math.max(previous.to, ends[start + trim.length - 1]);
        previous.text = text.slice(sentenceStart, start + trim.length).trim();
        continue;
      }
      sentenceStart = start;
      units.push({
        kind: "sentence",
        from: positions[start],
        to: ends[start + trim.length - 1],
        text: trim,
      });
    }
  }
  return units;
}

/** One transaction preserves inline marks and block attributes, with no rewriting. */
export function moveArrangementUnit(
  state: EditorState,
  unit: ArrangementUnit,
  destination: number,
): { tr: Transaction; inserted: ArrangementUnit } | null {
  if (
    !Number.isInteger(destination) ||
    destination < 0 ||
    destination > state.doc.content.size
  )
    return null;
  const actual = documentUnits(state.doc).find(
    (item) =>
      item.kind === unit.kind &&
      item.from === unit.from &&
      item.to === unit.to &&
      item.text === unit.text,
  );
  if (!actual) throw new Error("The document changed. Pick up the unit again.");
  let from = unit.from,
    to = unit.to;
  let content = state.doc.slice(from, to).content;
  if (unit.kind === "paragraph" && content.childCount > 1) {
    // Commit a legacy wrapped paragraph as one semantic paragraph. Otherwise
    // it could merge into adjacent line runs or lose its identity after moving.
    let inline = Fragment.empty;
    content.forEach((node) => {
      if (inline.size)
        inline = inline.append(Fragment.from(state.schema.text(" ")));
      inline = inline.append(node.content);
    });
    content = Fragment.from(content.firstChild!.copy(inline));
  }
  if (
    unit.kind === "sentence" &&
    state.doc.resolve(from).parent !== state.doc.resolve(to).parent
  ) {
    // A sentence can cross legacy line blocks. Extract their inline content,
    // preserving marks and separating source lines with a space.
    content = Fragment.empty;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return;
      if (content.size)
        content = content.append(Fragment.from(state.schema.text(" ")));
      content = content.append(
        node.content.cut(
          Math.max(0, from - pos - 1),
          Math.min(node.content.size, to - pos - 1),
        ),
      );
      return false;
    });
  }
  if (unit.kind === "sentence") {
    const end = state.doc.resolve(to),
      start = state.doc.resolve(from);
    if (
      end.parentOffset < end.parent.content.size &&
      /\s/.test(state.doc.textBetween(to, to + 1))
    )
      to++;
    else if (
      start.parentOffset > 0 &&
      /\s/.test(state.doc.textBetween(from - 1, from))
    )
      from--;
  }
  if (destination >= from && destination <= to) return null;
  const tr = state.tr.delete(from, to);
  const at = tr.mapping.map(destination);
  let insertedFrom = at,
    insertedTo = at + content.size;
  if (unit.kind === "sentence") {
    const target = tr.doc.resolve(at);
    if (!target.parent.inlineContent)
      throw new Error("Drop a sentence on a sentence boundary.");
    const prefix =
      target.parentOffset > 0 && !/\s/.test(tr.doc.textBetween(at - 1, at))
        ? " "
        : "";
    const suffix =
      target.parentOffset < target.parent.content.size &&
      !/\s/.test(tr.doc.textBetween(at, at + 1))
        ? " "
        : "";
    let result = prefix
      ? Fragment.from(state.schema.text(prefix)).append(content)
      : content;
    if (suffix)
      result = result.append(Fragment.from(state.schema.text(suffix)));
    tr.insert(at, result);
    insertedFrom += prefix.length;
    insertedTo += prefix.length;
  } else tr.insert(at, content);
  tr.doc.check();
  return { tr, inserted: { ...unit, from: insertedFrom, to: insertedTo } };
}
