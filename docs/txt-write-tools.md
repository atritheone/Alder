# TXT Write tools

Open TXT in the usual Write view. Line numbers occupy the page's left edge; they
are editor controls and are never saved into the file. Font and size affect the
display. The file retains plain text.

The Write toolbar provides font/size, Undo, Redo, Find, line numbers, word wrap,
visible whitespace and **Text tools**. Advanced tools stay in the overflow or
the **Text** menu. Rich controls appear for formats that retain their features.

Formatting marks default off in Sandbox and on in DOCX and book Write. Each
editor keeps its own saved choice. Narration temporarily hides formatting marks
in all editors, including TXT whitespace, while preparing or playing. Stopping
restores the saved choices. Markdown retains the rich editor and its Raw toggle.
Fold arrows use a stable gutter slot so they
do not displace change markers or line numbers. The contrasting grey gutter puts
fold arrows left of the line numbers and change bars beside the text area.
The number column sits directly beside the arrows and widens only when more
line-number digits are needed.

## Frequent actions

| Action | Default shortcut |
| --- | --- |
| Complete a word from the current file | Ctrl/Cmd+Space or Ctrl/Cmd+Enter |
| Accept a visible completion | Enter or Tab |
| Complete a filesystem path manually | Ctrl+Alt+Space, also in Commands |
| Go to line/column | Ctrl/Cmd+G |
| Select next occurrence | Ctrl/Cmd+D |
| Select all occurrences | Ctrl/Cmd+Shift+L |
| Toggle bookmark | Ctrl/Cmd+F2 |
| Next / previous bookmark | F2 / Shift+F2 |
| Command palette and custom shortcuts | Ctrl/Cmd+Shift+P |
| Insert / overwrite | Insert |

Select a word to highlight its matches. Completion searches the whole current
file, including text outside the visible area. Settings → Text editor controls
the suggestion threshold and occurrence matching preferences.

Text tools contains line transforms, cleanup/sort modes, marks/bookmarks,
column insertion/numbering, macros/snippets, clipboard/insertion, folding/syntax,
read-only, clone view and optional overview navigation. Recorded macros contain
relative edits and selections; replay prepares a bounded batch and applies one
undoable change. Clipboard history is opt-in and records copies made here.

## Searching and files

Find supports literal text, escaped characters and JavaScript regex. Edit also
searches open TXT documents. Replacement checks that searched text is unchanged;
each changed open document has independent undo. Empty regex matches are refused
and slow patterns are stopped in a worker.

**Text tools → File tools** exposes the path, file status, comparison, monitoring
and reopening. Reload opens a separate workspace and retains the working copy.
Reopen encoding decodes disk bytes into a new workspace using the chosen encoding;
it is separate from save encoding. Save refuses unrepresentable characters.
Choose UTF-8 or UTF-16 to retain them.

Recovery autosave and the source file are distinct. Ctrl/Cmd+S writes the bound
file; Save As chooses a destination. Changed/missing sources produce a conflict
notice while retaining recovery text. File → Save all TXT documents stops if a
destination is cancelled. Tabs support pinning, bulk close and reopening.

EOL settings preserve source endings, including mixed endings, or convert to LF,
CRLF or CR. The baseline is the imported/reopened file. After saving a conversion,
reopen that file to use its new endings as the preservation baseline.

**Folder workspace** starts with an explicitly chosen local folder. Include and
exclude filters narrow scanning. Results open in normal tabs. Replacement needs
a preview; verified backups precede writes, and restore refuses to overwrite newer
authored work. Backups remain in Alder data under `backups/text-replacements`.

TXT session restoration can be disabled in Text editor settings. See the
[implementation record](txt-editor-plan.md#measured-limits-and-boundaries) for
large-file, folder-operation and platform limits.
