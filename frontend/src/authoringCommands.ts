/** IDs are independent of display labels. Keep aliases when wording changes. */
const definitions = [
  ["format.bold", "Bold", "strong font weight"],
  ["format.italic", "Italic", "emphasis font"],
  ["format.underline", "Underline", "font"],
  ["format.strike", "Strikethrough", "strike font"],
  ["format.subscript", "Subscript", "baseline font"],
  ["format.superscript", "Superscript", "baseline font"],
  ["format.highlight", "Highlight", "text background"],
  ["format.clear-character", "Clear character formatting", "reset font"],
  ["format.reset-paragraph", "Reset paragraph formatting", "clear indents spacing"],
  [
    "page.setup",
    "Page setup…",
    "paper margins orientation size columns gutter",
  ],
  [
    "paragraph.properties",
    "Paragraph…",
    "tabs indents hanging leaders spacing pagination",
  ],
  [
    "paragraph.tabs",
    "Tabs…",
    "tab stops leaders default interval alignment decimal bar",
  ],
  ["insert.table", "Insert table…", "grid rows columns"],
  ["insert.image", "Insert image…", "picture photograph"],
  ["insert.link", "Insert link…", "hyperlink URL"],
  ["insert.text-box", "Insert text box…", "textbox frame"],
  ["insert.shape", "Insert shape…", "drawing rectangle arrow"],
  ["insert.equation", "Insert equation…", "math formula"],
  ["insert.symbol", "Insert symbol…", "characters unicode"],
  ["insert.form", "Insert form field…", "control checkbox"],
  ["insert.field", "Insert field…", "date page number merge"],
  ["references.notes", "Notes…", "footnotes endnotes"],
  ["references.sources", "Sources…", "citations bibliography"],
  ["references.contents", "Insert table of contents…", "toc headings contents"],
  ["references.bookmarks", "Bookmarks…", "navigation destination"],
  [
    "references.cross-reference",
    "Insert cross-reference…",
    "reference page heading figure",
  ],
  ["references.index", "Index entries…", "index keyword"],
  ["references.update", "Update fields", "refresh contents numbers references"],
  ["review.comments", "Comments…", "annotation discussion"],
  [
    "review.changes",
    "Review changes…",
    "track changes accept reject revisions",
  ],
  ["review.accessibility", "Check accessibility…", "alt text headings"],
  ["review.compare", "Compare documents…", "difference versions"],
  ["review.combine", "Combine reviewed copies…", "merge revisions"],
  ["document.mail-merge", "Mail merge…", "recipients letters"],
  ["section.properties", "Section properties…", "section layout"],
  ["section.insert", "Insert section break…", "continuous odd even next page"],
  [
    "section.running-matter",
    "Headers and footers…",
    "running head page numbers",
  ],
  ["break.page", "Insert page break", "pagination"],
  ["break.column", "Insert column break", "columns"],
  ["format.colour", "Text colour…", "font color"],
  ["format.copy", "Copy formatting", "format painter"],
  ["format.paste", "Paste formatting", "format painter"],
] as const;
const byLabel = new Map<
  string,
  { id: string; label: string; keywords: string[] }
>(
  definitions.map(([id, label, words]) => [
    label,
    { id, label, keywords: words.split(" ") },
  ]),
);
byLabel.set("Table of contents…", byLabel.get("Insert table of contents…")!);
const byId = new Map(
  [...byLabel.values()].map((command) => [command.id, command]),
);
export function authoringCommand(labelOrId: string) {
  return (
    byId.get(labelOrId) ||
    byLabel.get(labelOrId) || {
      id: labelOrId.startsWith("format.")
        ? labelOrId
        : `format.${labelOrId
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/-$/, "")}`,
      label: labelOrId,
      keywords: [],
    }
  );
}
