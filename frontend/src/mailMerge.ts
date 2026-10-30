import type { DocNode, Project } from "./types";

export function mergeFieldKeys(value: unknown): string[] {
  const keys = new Set<string>();
  const visit = (item: any) => {
    if (!item || typeof item !== "object") return;
    if (item.type === "document_field" && item.attrs?.fieldKind === "merge")
      keys.add(item.attrs.mergeKey);
    Object.values(item).forEach(visit);
  };
  visit(value);
  return [...keys].sort();
}
export function mergeTemplateContent(project: Project) {
  return {
    book: {
      ...project.book,
      chapters: project.book?.chapters.filter((c) => c.include !== false) || [],
    },
    settings: project.settings,
  };
}
export function mergeRecordSelection(text: string, count: number): number[] {
  if (!text.trim()) return [];
  const records = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match)
      throw new Error("Use record numbers or ranges, for example 1-3, 8.");
    const first = Number(match[1]),
      last = Number(match[2] || match[1]);
    if (first < 1 || last < first || last > count)
      throw new Error(`Choose records between 1 and ${count}.`);
    if (last - first > 99)
      throw new Error("Select at most 100 records per merge.");
    for (let i = first; i <= last; i++) records.add(i);
    if (records.size > 100)
      throw new Error("Select at most 100 records per merge.");
  }
  return [...records].sort((a, b) => a - b);
}
export function mergePreview(
  document: DocNode,
  values: Record<string, string>,
): DocNode {
  const visit = (node: DocNode): DocNode[] => {
    if (node.type === "document_field" && node.attrs?.fieldKind === "merge") {
      const value = values[node.attrs.mergeKey];
      if (value === undefined) return [node];
      return value
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .flatMap((text, i) => [
          ...(i ? [{ type: "hard_break" }] : []),
          ...(text ? [{ type: "text", text, marks: node.marks }] : []),
        ]);
    }
    return [
      {
        ...node,
        ...(node.content ? { content: node.content.flatMap(visit) } : {}),
        ...(node.type === "document_note"
          ? {
              attrs: {
                ...node.attrs,
                body: mergePreview(node.attrs!.body, values),
              },
            }
          : {}),
      },
    ];
  };
  return visit(document)[0];
}
