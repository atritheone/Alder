type HeaderCell = { header: boolean; rowspan: number };

/** Repeat only a closed prefix of heading rows. A cell merged into body rows
 * belongs to that connected grid, so repeating it would repeat body content. */
export function repeatingTableHeaders(rows: readonly (readonly HeaderCell[])[]) {
  let count = 0, boundary = 0;
  for (let row = 0; row < rows.length; row++) {
    if (!rows[row].length || !rows[row].every(cell => cell.header)) break;
    for (const cell of rows[row]) boundary = Math.max(boundary, row + cell.rowspan);
    if (boundary === row + 1) count = row + 1;
  }
  return count === rows.length ? 0 : count;
}
