import type { Project } from "./types";
export type EditorFileType =
  | "txt"
  | "md"
  | "html"
  | "docx"
  | "odt"
  | "rtf"
  | "book"
  | "alder";
export type ToolbarFeature =
  | "emphasis"
  | "underline"
  | "font-format"
  | "paragraph"
  | "alignment"
  | "lists"
  | "quote"
  | "images"
  | "tables"
  | "advanced-format"
  | "review"
  | "links"
  | "page-break"
  | "raw"
  | "txt-tools";
export function editorFileType(project: Project): EditorFileType {
  if (project.settings.documentKind === "txt") return "txt";
  if (
    project.settings.documentKind === "book" ||
    !project.settings.documentKind
  )
    return "book";
  const format = project.settings.preferredFormat;
  return ["md", "html", "docx", "odt", "rtf", "alder"].includes(format)
    ? format
    : "docx";
}
export function toolbarSupports(
  type: EditorFileType,
  feature: ToolbarFeature,
): boolean {
  if (feature === "txt-tools") return type === "txt";
  if (type === "txt") return false;
  if (type === "md")
    return ["emphasis", "paragraph", "lists", "quote", "links", "raw"].includes(
      feature,
    );
  if (feature === "review") return ["docx", "book", "alder"].includes(type);
  return true;
}

/** Commands whose authored metadata is retained only by Alder/DOCX. */
export function formatActionSupported(
  type: EditorFileType,
  label: string,
): boolean {
  if (type === "txt") return false;
  if (
    [
      "Comments…",
      "Review changes…",
      "Combine reviewed copies…",
      "Index entries…",
      "Insert form field…",
      "Form field properties…",
      "Insert text box…",
      "Text box properties…",
    ].includes(label)
  )
    return ["docx", "book", "alder"].includes(type);
  return true;
}
