/** Preserve the measured paint while supplying one logical table per page
 * fragment. Its repeated heading belongs to that table, not a separate table.
 * Additional headings in later columns remain visual repetitions. */
export function preparePublicationSemantics(sheet: HTMLElement) {
  // Chromium does not currently emit a tagged MathML node. A described graphic
  // preserves the complete reading alternative without exposing hidden caches.
  for(const equation of sheet.querySelectorAll('[data-equation]')){
    equation.setAttribute('role','img');
    // Skia drops an empty graphic tag when all of its painted descendants are
    // aria-hidden. The img role supplies one atomic alternative for the math.
    equation.querySelector('math')?.removeAttribute('aria-hidden');
  }
  // Chromium omits bare SVG paths from its tagged PDF tree. A self-contained
  // SVG image keeps vector paint and supplies one Figure with alternative text.
  for (const shape of sheet.querySelectorAll<HTMLElement>("[data-document-shape]")) {
    const svg=shape.querySelector("svg");if(!svg)continue;
    svg.setAttribute("xmlns","http://www.w3.org/2000/svg");
    const picture=document.createElement("img");
    picture.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(new XMLSerializer().serializeToString(svg));
    picture.alt=shape.getAttribute("aria-hidden")==="true"?"":shape.getAttribute("aria-label")||"";
    picture.style.cssText="display:block;width:100%;height:100%;max-width:none";
    shape.setAttribute("role","presentation");shape.removeAttribute("aria-label");
    svg.replaceWith(picture);
  }
  for (const figure of sheet.querySelectorAll("figure"))
    figure.setAttribute("role", "presentation");
  for (const object of sheet.querySelectorAll(
    '[data-image-decorative="true"],.page-break,.pagination-spacer,.structure-marker,.ProseMirror-separator',
  ))
    object.setAttribute("aria-hidden", "true");
  const hasContent = (element: Element) =>
    !!element.querySelector(
      '[data-publication-top],[data-document-shape]:not([aria-hidden="true"]),img:not([aria-hidden="true"]):not([data-image-decorative="true"])',
    );
  for (const row of sheet.querySelectorAll<HTMLTableRowElement>(
    "table[data-publication-table] tr",
  )) {
    if (!hasContent(row)) row.setAttribute("aria-hidden", "true");
  }
  for (const table of sheet.querySelectorAll<HTMLTableElement>(
    "table[data-publication-table]",
  )) {
    if (
      table.closest('[aria-hidden="true"]') ||
      table.parentElement?.closest("table")
    )
      continue;
    const header = [
      ...sheet.querySelectorAll<HTMLElement>(".repeated-table-header"),
    ].find(
      (element) =>
        element.dataset.sourceTable === table.dataset.publicationTable,
    );
    const first = [...table.rows].find(
      (row) => !row.classList.contains("pagination-spacer"),
    );
    if (!header || !first || hasContent(first)) continue;
    // This wrapper establishes no containing block: both frozen tables keep
    // their existing absolute coordinates relative to the physical sheet.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "table");
    const top = table.closest<HTMLElement>("[data-publication-block]") || table;
    if (top !== table && top.querySelectorAll("table").length !== 1) continue;
    top.before(wrapper);
    wrapper.append(header, top);
    header.removeAttribute("aria-hidden");
    header.removeAttribute("inert");
    for (const nested of [header.querySelector("table")!, table]) {
      nested.setAttribute("role", "presentation");
      for (const group of nested.querySelectorAll(
        ":scope > tbody,:scope > thead,:scope > tfoot",
      ))
        group.setAttribute("role", "rowgroup");
      for (const row of [...nested.rows]) {
        row.setAttribute("role", "row");
        const allHeaders = [...row.cells].every(
          (cell) => cell.tagName === "TH",
        );
        for (const cell of [...row.cells])
          cell.setAttribute(
            "role",
            cell.tagName === "TH"
              ? allHeaders
                ? "columnheader"
                : "rowheader"
              : "cell",
          );
      }
    }
  }
}
