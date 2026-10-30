import catalogue from "../../backend/alder/stationery-presets.json";
export const stationeryPresets = catalogue;
export const stationeryPreset = (id?: string | null) =>
  catalogue.find((item) => item.id === id);
export function stationeryPrintHint(id?: string | null) {
  const stock = stationeryPreset(id);
  const labels = stock?.labelColumns
    ? ` Labels ${stock.columns[0]} × ${stock.rows[0]} mm, ${stock.columns[1]} mm horizontal gap.`
    : "";
  return stock
    ? `${stock.name} · ${stock.paper[0]} × ${stock.paper[1]} mm.${labels} Print at actual size (100%), one-sided; choose matching paper and the correct feed tray in the printer window.`
    : "";
}

/** Publication-only measurement. Overflow stays editable and is never clipped. */
export function assertStationeryFits(
  root: HTMLElement,
  id: string | null | undefined,
  pages: number,
) {
  const stock = stationeryPreset(id);
  if (!stock) return;
  const fail = () => {
    throw new Error(
      "The content no longer fits this stationery. Shorten the address or reduce its type size. To use ordinary pages, turn off Check stationery fit in Settings → Page Layout.",
    );
  };
  if (pages !== 1) fail();
  const tables = [
    ...root.querySelectorAll<HTMLTableElement>(
      ".ProseMirror > .tableWrapper > table, .ProseMirror > table",
    ),
  ];
  if (tables.length !== 1) fail();
  const table = tables[0],
    rect = table.getBoundingClientRect();
  const px = 96 / 25.4,
    tolerance = 1.2;
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  if (
    table.rows.length !== stock.rows.length ||
    !near(rect.width, stock.columns.reduce((a, b) => a + b, 0) * px)
  )
    fail();
  let y = rect.top;
  for (let row = 0; row < stock.rows.length; row++) {
    const tr = table.rows[row],
      bounds = tr.getBoundingClientRect();
    if (
      tr.cells.length !== stock.columns.length ||
      !near(bounds.top, y) ||
      !near(bounds.height, stock.rows[row] * px)
    )
      fail();
    let x = rect.left;
    for (let column = 0; column < stock.columns.length; column++) {
      const cell = tr.cells[column],
        box = cell.getBoundingClientRect();
      if (!near(box.left, x) || !near(box.width, stock.columns[column] * px))
        fail();
      // Fixed-height objects can protrude without expanding a table row.
      const range = document.createRange();
      range.selectNodeContents(cell);
      for (const ink of range.getClientRects())
        if (
          ink.width &&
          ink.height &&
          (ink.top < box.top - tolerance ||
            ink.bottom > box.bottom + tolerance ||
            ink.left < box.left - tolerance ||
            ink.right > box.right + tolerance)
        )
          fail();
      x += stock.columns[column] * px;
    }
    y += stock.rows[row] * px;
  }
}
