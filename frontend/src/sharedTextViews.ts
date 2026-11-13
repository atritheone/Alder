import {
  ChangeSet,
  type ChangeDesc,
  type Transaction,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

function replacementMap(before: string, after: string): ChangeDesc {
  let start = 0,
    end = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++;
  return ChangeSet.of(
    {
      from: start,
      to: before.length - end,
      insert: after.slice(start, after.length - end),
    },
    before.length,
  );
}
/** Share text/history/metadata while each visible editor keeps its own selection. */
export function synchronizeTextViews(
  source: EditorView,
  peers: ReadonlySet<EditorView>,
  mapping?: ChangeDesc,
) {
  for (const peer of peers) {
    if (peer === source) continue;
    const changes =
      mapping && mapping.length === peer.state.doc.length
        ? mapping
        : replacementMap(
            peer.state.doc.toString(),
            source.state.doc.toString(),
          );
    const selection = peer.state.selection.map(changes),
      top = peer.scrollDOM.scrollTop,
      left = peer.scrollDOM.scrollLeft;
    peer.setState(source.state.update({ selection }).state);
    peer.scrollDOM.scrollTop = top;
    peer.scrollDOM.scrollLeft = left;
    if (peer.dom.closest(".txt-secondary-host"))
      peer.contentDOM.setAttribute("aria-label", "TXT secondary view");
  }
  if (source.dom.closest(".txt-secondary-host"))
    source.contentDOM.setAttribute("aria-label", "TXT secondary view");
}
export function dispatchSharedTextViews(
  peers: ReadonlySet<EditorView>,
  transactions: readonly Transaction[],
  source: EditorView,
) {
  source.update(transactions);
  if (!transactions.some((tr) => tr.docChanged || tr.effects.length)) return;
  let changes = transactions[0].changes;
  for (const tr of transactions.slice(1)) changes = changes.compose(tr.changes);
  synchronizeTextViews(source, peers, changes);
}
