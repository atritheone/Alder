import type { Project, DocNode, Clip } from "./types";
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (window.alder) return window.alder.request(method, path, body);
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const e = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    throw new Error(
      typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail || e),
    );
  }
  return response.json();
}
export async function upload<T = any>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<T> {
  if (window.alder)
    return window.alder.upload(
      path,
      file.name,
      Array.from(new Uint8Array(await file.arrayBuffer())),
      fields,
    );
  const form = new FormData();
  form.append("file", file);
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  const r = await fetch(path, { method: "POST", body: form });
  if (!r.ok) {
    const e = await r.json();
    throw new Error(e.detail || "Upload failed");
  }
  return r.json();
}
export const mediaUrl = (path: string) =>
  window.alder ? window.alder.mediaBase + path : path;
export function download(path: string, name: string) {
  if (window.alder) return window.alder.download(path, name);
  const a = document.createElement("a");
  a.href = path;
  a.download = name;
  a.click();
  return Promise.resolve(name);
}
export const uid = () => crypto.randomUUID();
export const textDoc = (text: string): DocNode => ({
  type: "doc",
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  })),
});
export function docText(doc: DocNode): string {
  if (doc.type === "text") return doc.text || "";
  if (doc.type === "hard_break") return "\n";
  return (doc.content || [])
    .map(docText)
    .join(
      ["doc", "bullet_list", "ordered_list", "table", "table_row"].includes(
        doc.type,
      )
        ? "\n"
        : "",
    );
}
export function newClip(
  trackId: string,
  slot: number,
  text = "",
  title = "Untitled clip",
): Clip {
  return {
    id: uid(),
    trackId,
    slot,
    title,
    document: textDoc(text),
    text,
    revision: 0,
    variants: [],
    activeVariantId: null,
    tags: [],
    language: "en",
    voiceId: null,
  };
}
export function chosenClip(clip: Clip) {
  return clip.variants?.find((v) => v.id === clip.activeVariantId) || clip;
}
export function orderedPlacements(project: Project) {
  return [...project.placements].sort((a, b) => {
    const sa = project.sections.find((s) => s.id === a.sectionId)?.order || 0,
      sb = project.sections.find((s) => s.id === b.sectionId)?.order || 0;
    return sa - sb || a.order - b.order;
  });
}
export function collatedText(project: Project) {
  return orderedPlacements(project)
    .filter((p) => p.include)
    .map((p) => {
      const c = project.clips.find((c) => c.id === p.clipId);
      return p.frozenText ?? (c ? chosenClip(c).text : "");
    })
    .join("\n\n");
}
export const words = (text: string) =>
  text.trim() ? text.trim().split(/\s+/u).length : 0;
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
