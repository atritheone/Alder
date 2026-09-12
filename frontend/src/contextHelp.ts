const descriptions: Record<string, string> = {
  Bold: "Make the selected text bold, or turn bold on for the text you type next. Shortcut: Ctrl+B.",
  Italic:
    "Italicise the selected text, or turn italics on for the text you type next. Shortcut: Ctrl+I.",
  Underline:
    "Underline selected text or the text you type next. Shortcut: Ctrl+U.",
  "Align left":
    "Align the current paragraph with the left edge of the text area.",
  "Align centre": "Centre the current paragraph between the margins.",
  "Align right":
    "Align the current paragraph with the right edge of the text area.",
  "Bullet list": "Turn the selected paragraphs into a bulleted list.",
  "Numbered list":
    "Turn the selected paragraphs into an ordered, numbered list.",
  "Block quote":
    "Format the current paragraph as a quotation set apart from the surrounding prose.",
  "Insert image":
    "Choose an image file to insert into the document at the cursor.",
  "Insert table":
    "Insert a table at the cursor to organise text into rows and columns.",
  "Add table row": "Add a row after the current row in the table.",
  "Add table column": "Add a column after the current column in the table.",
  "Delete table":
    "Remove the table containing the cursor, including its contents. Undo typing restores it.",
  "Insert link": "Attach a web or email address to the selected wording.",
  "Insert page break":
    "Start the following text on a new page without inserting blank paragraphs.",
  "Show structure":
    "Reveal paragraph and other structural marks to inspect the document's layout.",
  "Undo typing": "Undo the last edit in this text editor. Shortcut: Ctrl+Z.",
  "Redo typing": "Restore the last undone edit in this text editor.",
  "Toggle sandbox":
    "Show or hide the sandbox, a separate space for draft wording, language tools, and narration. Inserting a draft copies it into the chapter; editing the draft afterwards leaves the chapter unchanged.",
  "Reading speed":
    "Set playback speed precisely from 0.250× to 3.000× in steps of 0.001. Pitch stays the same. Type a value or use the arrows.",
  "Reading volume":
    "Adjust narration loudness from silent to 400%. Playback starts at 200%, with compression to control peaks.",
  "Chapter text editor":
    "Write and format your document. Text flows onto new pages automatically. Select words to explore alternatives or read the selection aloud.",
  "Draft text editor":
    "Try wording independently of your document. Use Insert into chapter to copy the draft into your writing.",
  "Book chapters":
    "Select, rename, reorder, or add chapters. Only included chapters appear in the publication.",
  "Language tools":
    "Check or transform the selected wording. Preview a change before applying it to your draft.",
  "Insert into chapter":
    "Insert a copy of this sandbox draft at the document cursor. The draft remains available for further experiments.",
  "Follow words":
    "Highlight only the word currently being spoken and keep it visible. Highlighting pauses where word timing is unavailable.",
  "Save document":
    "Save a copy in the document's chosen TXT or DOCX format. Alder also saves changes to the workspace automatically.",
  "Open document":
    "Open a document file. You can also drop files anywhere in Alder to open them as saved workspaces.",
  "Follow text":
    "Highlight only the word being read and scroll to keep it visible. Turn this off to read elsewhere while audio continues.",
  "Reading voice":
    "Choose the voice used to read this chapter. Your choice is saved with the chapter.",
  "Reading scope":
    "Read the current chapter, all included chapters, a text selection, or everything after the cursor.",
  Read: "Generate speech for the chosen text and begin playback when the first passage is ready.",
  "Document reader":
    "Listen to your writing, choose a voice, adjust speed and volume, or follow each spoken word on the page.",
  "Pause reading":
    "Pause at the current spoken position. Resume continues from the same point.",
  "Resume reading": "Continue listening from the paused position.",
  "Stop reading":
    "Stop playback and clear the word highlight. Generated audio remains available.",
  "Reading position":
    "Seek to a moment in the generated audio. Word highlighting follows the new playback position.",
  "Reading audio format":
    "Choose the format of the generated narration file: WAV, MP3, or FLAC.",
  "Reading bookmarks":
    "Jump to a saved place in the text. Read from cursor to listen from that point.",
  Clipboard:
    "Insert text from the clipboard as a new chapter in this workspace.",
  Styles:
    "Manage reusable paragraph and character formatting for this document.",
  "Page setup": "Set page size, margins, typography, and publication metadata.",
  Write:
    "Edit the continuous document. Pages flow automatically as the writing grows.",
  Pages:
    "Inspect and rearrange the document's writing pages while retaining their words and formatting.",
  "Page Preview":
    "Preview exported PDF pages or a reflowable reading view before saving a publication.",
  Sandbox:
    "Try wording in independent drafts, compare versions, and copy a finished draft into your document.",
  Narration:
    "Inspect generated audio, listen to passages, and review or save narration takes.",
  "Draft version":
    "Switch between the original wording and saved alternative versions of this draft.",
  "Create draft version":
    "Keep the current wording as an alternative draft version that you can return to later.",
  "Duplicate draft":
    "Create an independent copy of this draft for a new experiment.",
  "Split draft":
    "Create two drafts at a paragraph boundary while retaining the original wording.",
  "Combine drafts": "Combine this draft with the next draft in its collection.",
  "Font family":
    "Change the typeface of selected text or of the text you type next.",
  "Font size":
    "Change the size in points of selected text or the text you type next.",
  "Save project":
    "Save a portable Alder archive, or a TXT or DOCX copy for a simple document. Workspace changes are also saved automatically.",
  "Undo project change":
    "Undo the last saved structural or project change. Typing also has its own undo history in the editor.",
  "Redo project change": "Reapply the most recently undone project change.",
};

export function helpFor(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "";
  const element = target.closest(
    "[data-help], button, input, select, textarea, [contenteditable], [aria-label]",
  );
  if (!element || element.closest(".context-help, .statusbar"))
    return element?.getAttribute("data-help") || "";
  const label =
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.closest("label")?.textContent?.trim() ||
    element.textContent?.trim() ||
    "";
  return (
    element.getAttribute("data-help") ||
    descriptions[label] ||
    element.getAttribute("title") ||
    (label
      ? `${label}. ${element.tagName === "SELECT" ? "Choose an option from the list." : element.tagName === "INPUT" ? "Edit this setting; changes are saved with your workspace." : ""}`
      : "")
  );
}
