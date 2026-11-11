# Visual document structure

Write and Sandbox show document structure by default. Each editor's ¶ toolbar
button switches its own complete guide layer independently. View > Show/Hide
Structure targets the focused editor. The choices are saved on this device as
`alder.structure.write` and `alder.structure.sandbox`. Each initially inherits
the former shared `alder.structure` choice, or defaults to on. Subsequent choices
are independent and survive reopening Alder. Raw mode and publication preview
remain clean.

A blank page shows its writing-area boundary and the existing empty paragraph's
¶. More guides appear only when the document contains the corresponding feature:

| Structure | Visual cue |
| --- | --- |
| Paragraph, space, nonbreaking space, tab, manual line break | ¶, ·, °, →, ↵ |
| Body margins and columns | Faint dotted region outlines |
| Nonempty running headers and footers | Dotted regions in their page margins |
| Paragraph spacing | Small side brackets |
| First-line, left and right indents | Short horizontal offset guides |
| Keep-together and keep-with-next rules | Side brackets and linking strokes |
| Explicit page, column and section breaks | Dotted lines with ↡, ↦ and § |
| Paragraph-level page-break-before rule | ↡ beside the paragraph |
| Borderless table cells, text boxes, images, fields and other objects | Dotted bounds |
| Floating objects | A paragraph anchor; selecting the object reveals a leader |
| Bookmarks and index entries | Existing boundary marks |

Automatic wrapping has no break symbol. Automatic pagination uses the page edge,
without an explicit-break indicator. There are no extra numerical readouts. The
current paragraph's geometry cues are stronger than those elsewhere.

## Rendering and content safety

`PageStructureGuides` derives physical regions from the existing per-page layout,
including section frames, mirrored margins, gutters, columns and running-story
variants. The guide rectangles live on the page sheets, separate from page
furniture and authored borders.

`structureMarks` caches character descriptions for unchanged immutable text
blocks. Its widgets contain no text, and whitespace decorations retain the
original characters. Visibility uses CSS, preserving the editor DOM and native
selection when the master switch changes. Raw and unparseable source receive no
formatting decorations. Tab arrows use a separate pseudo-element from tab leaders,
so hiding structure or printing cannot hide an authored dotted or solid leader.

`structureGuides` paints measured paragraph and object cues into an aria-hidden,
non-interactive SVG outside ProseMirror. It uses computed formatting and existing
column-fragment geometry. Spanning paragraph brackets are clipped to physical
page bodies. Paint is coalesced into animation frames; ordinary page layouts
limit expensive style reads to the viewport neighbourhood. Column layouts use
the existing fragment mapper because source paragraph bounds alone cannot
identify every visible fragment. Resize, font, image, pagination, selection and
scroll changes refresh the overlay. Disposal removes observers and paint.

The guide layer cannot enter schema serialization or clipboard content. Page
snapshots explicitly remove formatting widgets and whitespace classes; the SVG
overlays are outside the copied body. Publication capture copies the authored
body and actual page furniture, not page-sheet guides. Print CSS also suppresses
guides and generated symbols.

## Verification

- `structureMarks.test.ts`: symbols, mixed whitespace, manual breaks, empty
  paragraphs, stable DOM, selection and unchanged document serialization.
- `PageStructureGuides.test.ts`: asymmetric mirrored margins, columns and
  first/even/default running-story variants.
- `test-structure-toggle-desktop.mjs`: repeated toggles, native-menu stability,
  stable document/scroll/pages, and undo.
- `test-document-structure-desktop.mjs`: blank defaults, saved preference,
  independent saved Write/Sandbox switches, mixed paper/columns, object anchors, identical geometry,
  UI scale/zoom, clean Arrangement/publication preview and clean Raw mode.
- `test-structure-reading-desktop.mjs`: 120 paragraphs, reading highlights deep
  in a long document, and stable text/page count while toggling guides.

These are developer checks using disposable data, not installation prerequisites.
