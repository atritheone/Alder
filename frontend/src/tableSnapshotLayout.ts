/** Freeze measured cells for read-only page copies. Native collapsed borders
 * snap differently when Chromium switches from a scaled screen to print. An
 * absolute cell grid avoids accumulating that rounding across hundreds of rows.
 * The editable table remains native, with its original selection semantics. */
export function freezeTableLayout(
  source: HTMLTableElement,
  target: HTMLTableElement,
  scale: number,
) {
  const origin = source.getBoundingClientRect();
  const rows = [...source.rows].filter(
    (row) => !row.classList.contains("pagination-spacer"),
  );
  const copies = [...target.rows].filter(
    (row) => !row.classList.contains("pagination-spacer"),
  );
  const visibleBottom = Math.max(
    ...rows
      .slice(0, copies.length)
      .flatMap((row) =>
        [...row.cells].map((cell) => cell.getBoundingClientRect().bottom),
      ),
    origin.top,
  );
  Object.assign(target.style, {
    position: "relative",
    display: "block",
    width: `${origin.width / scale}px`,
    height: `${origin.height / scale}px`,
    border: "0",
    borderCollapse: "separate",
    borderSpacing: "0",
  });
  for (const child of [...target.children]) {
    if (child.tagName === "COLGROUP")
      (child as HTMLElement).style.display = "none";
    else if (["THEAD", "TBODY", "TFOOT"].includes(child.tagName))
      (child as HTMLElement).style.display = "contents";
  }
  for (const row of [...target.rows])
    row.style.display = row.classList.contains("pagination-spacer")
      ? "none"
      : "contents";
  copies.forEach((row, index) => {
    if (!rows[index]) return;
    [...row.cells].forEach((cell, column) => {
      const original = rows[index].cells[column];
      if (!original) return;
      const rect = original.getBoundingClientRect(),
        style = getComputedStyle(original);
      const first = original.firstElementChild;
      const verticalOffset =
        first && style.verticalAlign !== "top"
          ? Math.max(
              0,
              (first.getBoundingClientRect().top - rect.top) / scale -
                (parseFloat(style.paddingTop) || 0) -
                (parseFloat(style.borderTopWidth) || 0) / 2 -
                (parseFloat(getComputedStyle(first).marginTop) || 0),
            )
          : 0;
      Object.assign(cell.style, {
        position: "absolute",
        display: "block",
        boxSizing: "border-box",
        margin: "0",
        left: `${(rect.left - origin.left) / scale}px`,
        top: `${(rect.top - origin.top) / scale}px`,
        width: `${rect.width / scale}px`,
        height: `${rect.height / scale}px`,
      });
      // Paint borders without letting print-time pixel snapping change padding
      // or cell size. Collapsed borders occupy half their width in each cell.
      const shadows: string[] = [];
      for (const [edge, x, y] of [
        ["top", 0, 1],
        ["right", -1, 0],
        ["bottom", 0, -1],
        ["left", 1, 0],
      ] as const) {
        const width =
          parseFloat(style.getPropertyValue(`border-${edge}-width`)) || 0;
        const padding =
          parseFloat(style.getPropertyValue(`padding-${edge}`)) || 0;
        cell.style.setProperty(
          `padding-${edge}`,
          `${padding + width / 2 + (edge === "top" ? verticalOffset : 0)}px`,
        );
        const outer =
          edge === "top"
            ? Math.abs(rect.top - origin.top) / scale < 1
            : edge === "bottom"
              ? Math.abs(rect.bottom - visibleBottom) / scale < 1
              : edge === "left"
                ? Math.abs(rect.left - origin.left) / scale < 1
                : Math.abs(rect.right - origin.right) / scale < 1;
        const paintWidth = outer ? width : width / 2;
        if (paintWidth)
          shadows.push(
            `inset ${x * paintWidth}px ${y * paintWidth}px 0 ${style.getPropertyValue(`border-${edge}-color`)}`,
          );
      }
      cell.style.border = "0";
      cell.style.boxShadow = shadows.join(",") || "none";
    });
  });
}

export function freezeTablesInCopy(
  source: Element,
  target: Element,
  scale: number,
) {
  const originals =
    source instanceof HTMLTableElement
      ? [source, ...source.querySelectorAll("table")]
      : [...source.querySelectorAll("table")];
  const copies =
    target instanceof HTMLTableElement
      ? [target, ...target.querySelectorAll("table")]
      : [...target.querySelectorAll("table")];
  originals.forEach((table, index) => {
    if (copies[index]) freezeTableLayout(table, copies[index], scale);
  });
}
