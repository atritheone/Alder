import type { DocNode } from "./types";

/** Match persisted block identities before recording project undo patches. */
export function plainTextDocument(text: string, previous?: DocNode): DocNode {
  return {
    type: "doc",
    content: text.split("\n").map((line, index) => {
      const old = previous?.content?.[index];
      const blockId = old?.attrs?.blockId || `block_${crypto.randomUUID()}`;
      if (
        old?.type === "paragraph" &&
        old.attrs?.blockId &&
        old.content?.length === (line ? 1 : 0) &&
        (!line ||
          (old.content?.[0]?.type === "text" && old.content[0].text === line))
      )
        return old;
      return {
        type: "paragraph",
        attrs: { blockId },
        ...(line ? { content: [{ type: "text", text: line }] } : {}),
      };
    }),
  };
}

const plainDocuments = new WeakMap<DocNode, boolean>();
/** Rich legacy TXT workspaces stay in the rich editor until explicitly converted. */
export function isPlainDocument(node: DocNode): boolean {
  const known = plainDocuments.get(node);
  if (known !== undefined) return known;
  const result =
    ["doc", "paragraph", "text", "hard_break"].includes(node.type) &&
    !node.marks?.length &&
    !Object.entries(node.attrs || {}).some(
      ([key, value]) => key !== "blockId" && value != null && value !== "",
    ) &&
    (node.content || []).every(isPlainDocument);
  plainDocuments.set(node, result);
  return result;
}

export type TextOperation =
  | "upper"
  | "lower"
  | "title"
  | "sentence"
  | "invert"
  | "trim-start"
  | "trim-end"
  | "trim"
  | "remove-empty"
  | "remove-blank"
  | "unique"
  | "unique-adjacent"
  | "sort"
  | "sort-desc"
  | "sort-natural"
  | "sort-insensitive"
  | "sort-numeric"
  | "reverse"
  | "join"
  | "tabs-spaces"
  | "spaces-tabs";

export function transformText(
  text: string,
  operation: TextOperation,
  tabSize = 4,
): string {
  if (operation === "upper") return text.toUpperCase();
  if (operation === "lower") return text.toLowerCase();
  if (operation === "sentence")
    return text.replace(
      /(^|[.!?]\s+|\n\s*)(\p{L})/gu,
      (_all, before: string, letter: string) => before + letter.toUpperCase(),
    );
  if (operation === "title")
    return text
      .toLowerCase()
      .replace(
        /\p{L}[\p{L}\p{M}]*/gu,
        (word) => word[0].toUpperCase() + word.slice(1),
      );
  if (operation === "invert")
    return Array.from(text, (c) =>
      c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase(),
    ).join("");
  const final = text.endsWith("\n");
  let lines = text.split("\n");
  if (final) lines.pop();
  switch (operation) {
    case "trim-start":
      lines = lines.map((line) => line.replace(/^[\t ]+/, ""));
      break;
    case "trim-end":
      lines = lines.map((line) => line.replace(/[\t ]+$/, ""));
      break;
    case "trim":
      lines = lines.map((line) => line.replace(/^[\t ]+|[\t ]+$/g, ""));
      break;
    case "remove-empty":
      lines = lines.filter((line) => line !== "");
      break;
    case "remove-blank":
      lines = lines.filter((line) => /\S/u.test(line));
      break;
    case "unique":
      lines = [...new Set(lines)];
      break;
    case "unique-adjacent":
      lines = lines.filter((line, i) => i === 0 || line !== lines[i - 1]);
      break;
    case "sort":
      lines.sort();
      break;
    case "sort-desc":
      lines.sort().reverse();
      break;
    case "sort-natural":
      lines.sort(new Intl.Collator(undefined, { numeric: true }).compare);
      break;
    case "sort-insensitive":
      lines.sort((a, b) =>
        a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase()),
      );
      break;
    case "sort-numeric":
      lines.sort((a, b) => {
        const av = Number(a.trim()),
          bv = Number(b.trim());
        if (Number.isFinite(av) && Number.isFinite(bv)) return av - bv;
        if (Number.isFinite(av)) return -1;
        if (Number.isFinite(bv)) return 1;
        return 0;
      });
      break;
    case "reverse":
      lines.reverse();
      break;
    case "join":
      return lines.join(" ");
    case "tabs-spaces":
      lines = lines.map((line) => {
        let column = 0;
        return Array.from(line, (c) => {
          if (c === "\t") {
            const n = tabSize - (column % tabSize);
            column += n;
            return " ".repeat(n);
          }
          column++;
          return c;
        }).join("");
      });
      break;
    case "spaces-tabs":
      lines = lines.map((line) =>
        line.replace(
          /^ +/,
          (spaces) =>
            "\t".repeat(Math.floor(spaces.length / tabSize)) +
            " ".repeat(spaces.length % tabSize),
        ),
      );
      break;
  }
  return lines.join("\n") + (final && lines.length ? "\n" : "");
}
