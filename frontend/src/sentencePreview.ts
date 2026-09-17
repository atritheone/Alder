import type { ArrangementUnit } from "./arrangementUnits";

/** Resolve a saved document position inside a snapshot, ignoring the temporary gap. */
export function inlinePoint(
  root: HTMLElement,
  pos: number,
  removed?: ArrangementUnit,
) {
  for (const span of root.querySelectorAll<HTMLElement>(
    "[data-arrange-from]",
  )) {
    const from = Number(span.dataset.arrangeFrom),
      to = Number(span.dataset.arrangeTo);
    if (pos < from || pos > to) continue;
    let offset = pos - from;
    if (removed)
      offset -= Math.max(
        0,
        Math.min(pos, removed.to) - Math.max(from, removed.from),
      );
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      if (text.parentElement?.closest(".sentence-inline-gap")) continue;
      last = text;
      if (offset <= text.length)
        return { node: text, offset: Math.max(0, offset) };
      offset -= text.length;
    }
    if (last) return { node: last, offset: last.length };
  }
  return null;
}

export function sentenceContents(snapshot: HTMLElement, unit: ArrangementUnit) {
  const start = inlinePoint(snapshot, unit.from),
    end = inlinePoint(snapshot, unit.to);
  if (!start || !end) {
    const escaped = document.createElement("span");
    escaped.textContent = unit.text;
    return escaped.innerHTML;
  }
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const holder = document.createElement("span");
  holder.append(range.cloneContents());
  // cloneContents omits ancestors of the common container. Retain inline
  // marks (e.g. bold/italic) even when the whole sentence is in one text node.
  let ancestor =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : (range.commonAncestorContainer as HTMLElement);
  while (ancestor && !ancestor.matches("[data-textblock-from],.ProseMirror")) {
    const wrap = ancestor.cloneNode(false) as HTMLElement;
    wrap.append(...holder.childNodes);
    holder.append(wrap);
    ancestor = ancestor.parentElement;
  }
  // Legacy wrapped sentences may span several source paragraphs.
  holder
    .querySelectorAll("p,h1,h2,h3,h4,h5,h6,pre")
    .forEach((block) =>
      block.replaceWith(...block.childNodes, document.createTextNode(" ")),
    );
  if (
    holder.lastChild?.nodeType === Node.TEXT_NODE &&
    holder.lastChild.textContent === " "
  )
    holder.lastChild.remove();
  holder
    .querySelectorAll(".pagination-spacer,.structure-marker")
    .forEach((el) => el.remove());
  holder.querySelectorAll("*").forEach((el) => {
    el.removeAttribute("data-arrange-from");
    el.removeAttribute("data-arrange-to");
    el.removeAttribute("data-textblock-from");
  });
  return holder.innerHTML;
}

/** Reflow only the destination text block in a disposable page copy. */
export function sentencePreview(
  snapshot: HTMLElement,
  unit: ArrangementUnit,
  html: string,
) {
  const charAt = (pos: number) => {
    for (const span of snapshot.querySelectorAll<HTMLElement>(
      "[data-arrange-from]",
    )) {
      const start = Number(span.dataset.arrangeFrom),
        end = Number(span.dataset.arrangeTo);
      if (pos >= start && pos < end)
        return (span.textContent || "")[pos - start];
    }
    return "";
  };
  const removed = { ...unit };
  if (/\s/.test(charAt(unit.to))) removed.to++;
  else if (/\s/.test(charAt(unit.from - 1))) removed.from--;
  const overlay = document.createElement("div");
  overlay.className = "unit-drop-preview sentence-drop-preview";
  snapshot.append(overlay);
  let copy: HTMLElement | null = null;
  let gap: HTMLElement | null = null;
  let destination: number | null = null;
  let removedBlock: HTMLElement | null = null;
  return {
    overlay,
    update(pos: number) {
      if (destination === pos) return;
      destination = pos;
      // Clone only the page's document, never an existing preview/overlay.
      const original = snapshot.querySelector<HTMLElement>(
        ":scope > .ProseMirror",
      )!;
      copy = original.cloneNode(true) as HTMLElement;
      overlay.replaceChildren(copy);
      const point = inlinePoint(copy, pos);
      let block = point?.node.parentElement?.closest<HTMLElement>(
        "[data-textblock-from]",
      );
      if (!block)
        block = copy.querySelector<HTMLElement>(
          `[data-textblock-from="${pos}"]`,
        );
      if (!block) return;
      const topBlock = Array.from(copy.children).find((el) =>
        el.contains(block!),
      ) as HTMLElement;
      const originalHeight = topBlock.getBoundingClientRect().height;
      // Remove the held sentence if it is also in this page, while retaining
      // the original coordinate metadata for stable drop positions.
      const affected = new Set<HTMLElement>();
      removedBlock = null;
      for (const span of copy.querySelectorAll<HTMLElement>(
        "[data-arrange-from]",
      )) {
        const from = Number(span.dataset.arrangeFrom),
          to = Number(span.dataset.arrangeTo);
        const start = Math.max(from, removed.from),
          end = Math.min(to, removed.to);
        if (end <= start) continue;
        const parent = span.closest<HTMLElement>("[data-textblock-from]");
        // Only close up the source when it shares the destination block. Other
        // source blocks retain their placeholder until the document is committed.
        if (parent !== block) continue;
        const value = span.textContent || "";
        span.textContent =
          value.slice(0, start - from) + value.slice(end - from);
        affected.add(parent);
        removedBlock = parent;
      }
      const inserted = inlinePoint(
        block,
        pos,
        affected.has(block) ? removed : undefined,
      );
      gap = document.createElement("span");
      gap.className = "sentence-inline-gap is-unit-gap";
      gap.innerHTML = html;
      if (inserted) {
        const range = document.createRange();
        range.setStart(inserted.node, inserted.offset);
        range.collapse(true);
        const beforeRange = document.createRange(),
          afterRange = document.createRange();
        beforeRange.selectNodeContents(block);
        beforeRange.setEnd(inserted.node, inserted.offset);
        afterRange.selectNodeContents(block);
        afterRange.setStart(inserted.node, inserted.offset);
        const before = beforeRange.toString(),
          after = afterRange.toString();
        const fragment = document.createDocumentFragment();
        if (before && !/\s$/.test(before))
          fragment.append(document.createTextNode(" "));
        fragment.append(gap);
        if (after && !/^\s/.test(after))
          fragment.append(document.createTextNode(" "));
        range.insertNode(fragment);
      } else {
        block.replaceChildren(gap);
      }
      // Explicit snapshot heights must not constrain the local inline reflow.
      topBlock.style.height = "auto";
      const scale =
        snapshot.getBoundingClientRect().width /
        parseFloat(snapshot.style.width);
      const delta =
        (topBlock.getBoundingClientRect().height - originalHeight) / scale;
      const top = parseFloat(topBlock.style.top);
      for (const sibling of Array.from(copy.children) as HTMLElement[]) {
        if (sibling !== topBlock && parseFloat(sibling.style.top) > top)
          sibling.style.transform = `translateY(${delta}px)`;
      }
      // Keep other-page source portions lifted, without masking the new gap.
      snapshot
        .querySelectorAll<HTMLElement>(":scope > .unit-source-mask")
        .forEach((mask) => {
          if (!affected.size) overlay.append(mask.cloneNode(true));
        });
    },
    contains(x: number, y: number) {
      return (
        gap &&
        Array.from(gap.getClientRects()).some(
          (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
        )
      );
    },
    position(pos: number) {
      if (!copy) return null;
      const candidate = inlinePoint(copy, pos);
      const point =
        candidate?.node.parentElement?.closest("[data-textblock-from]") ===
        removedBlock
          ? inlinePoint(copy, pos, removed)
          : candidate;
      if (!point) return null;
      const range = document.createRange();
      range.setStart(point.node, point.offset);
      range.collapse(true);
      const rect = range.getClientRects()[0];
      if (!rect) return null;
      const origin = snapshot.getBoundingClientRect(),
        scale = origin.width / parseFloat(snapshot.style.width);
      return {
        x: (rect.left - origin.left) / scale,
        y: (rect.top + rect.height / 2 - origin.top) / scale,
      };
    },
    destroy() {
      overlay.remove();
    },
  };
}
