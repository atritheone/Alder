import type { DocNode, Project } from "./types";

const cache = new WeakMap<DocNode, { id: string; name: string }[]>();
export function bookmarkTargets(document: DocNode) {
  let items = cache.get(document);
  if (!items) {
    items = [];
    const walk = (node: DocNode) => {
      if (node.type === "bookmark" && node.attrs?.blockId)
        items!.push({ id: node.attrs.blockId, name: node.attrs.name });
      node.content?.forEach(walk);
    };
    walk(document);
    cache.set(document, items);
  }
  return items;
}
export function bookBookmarkTargets(project: Project) {
  return (project.book?.chapters || []).flatMap((chapter) =>
    bookmarkTargets(chapter.document).map((item) => ({
      ...item,
      chapter: chapter.id,
      label: `${item.name} · ${chapter.title}`,
    })),
  );
}
