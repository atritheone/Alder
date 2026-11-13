import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import FontSizeField from "./FontSizeField";
import {
  toolbarSupports,
  type EditorFileType,
  type ToolbarFeature,
} from "./documentCapabilities";

const labelledFeatures: Record<string, ToolbarFeature> = {
  "Paragraph type": "paragraph",
  "Font family": "font-format",
  Bold: "emphasis",
  Italic: "emphasis",
  Underline: "underline",
  "Align left": "alignment",
  "Align centre": "alignment",
  "Align right": "alignment",
  Justify: "alignment",
  "Bullet list": "lists",
  "Numbered list": "lists",
  "Block quote": "quote",
  "Insert image": "images",
  "Insert table": "tables",
  "More formatting": "advanced-format",
  "Insert link": "links",
  "Insert page break": "page-break",
  Raw: "raw",
  "Line numbers": "txt-tools",
  "Word wrap": "txt-tools",
  "Show whitespace": "txt-tools",
  "Text tools": "txt-tools",
};

/** Shared Write chrome; each editor supplies only its applicable commands. */
export default function WriteToolbar({
  children,
  disabled = false,
  fileType = "alder",
  displayTypography = false,
}: {
  children: ReactNode;
  disabled?: boolean;
  fileType?: EditorFileType;
  displayTypography?: boolean;
}) {
  const relevant = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (node) => {
      if (
        !isValidElement<{
          children?: ReactNode;
          "aria-label"?: string;
          className?: string;
          value?: unknown;
        }>(node)
      )
        return node;
      const label = node.props["aria-label"],
        feature =
          node.type === FontSizeField
            ? "font-format"
            : node.props.className === "review-indicator"
              ? "review"
              : label
                ? labelledFeatures[label]
                : undefined;
      if (
        feature &&
        !(feature === "font-format" && displayTypography) &&
        !toolbarSupports(fileType, feature)
      )
        return null;
      if (
        node.type === "option" &&
        String(node.props.value).startsWith("style:") &&
        fileType === "md"
      )
        return null;
      return node.props.children
        ? cloneElement(node, {}, relevant(node.props.children))
        : node;
    });
  return (
    <div
      className="format-toolbar"
      role="toolbar"
      aria-label="Text formatting"
      data-file-type={fileType}
      aria-disabled={disabled || undefined}
      inert={disabled}
    >
      {relevant(children)}
    </div>
  );
}
