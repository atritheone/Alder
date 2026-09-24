export type DocumentPosition = {
  chapter: number;
  zoom: number;
  top: number;
  left: number;
  offset: number;
};
const sessionPositions = new Map<string, DocumentPosition>();
export function forgetSessionPosition(key: string) {
  sessionPositions.delete(key);
}
export function saveDocumentPosition(
  key: string,
  position: DocumentPosition,
  persist: boolean,
) {
  sessionPositions.set(key, position);
  if (persist) localStorage.setItem(key, JSON.stringify(position));
}
export function documentPositionKey(projectId: string) {
  return (
    "alder.documentPosition." +
    (localStorage.getItem("alder.documentSource." + projectId) || projectId)
  );
}
export function readDocumentPosition(key: string): DocumentPosition | null {
  if (sessionPositions.has(key)) return sessionPositions.get(key)!;
  if (localStorage.getItem("alder.rememberDocumentPosition") === "false")
    return null;
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (
      !value ||
      ![value.chapter, value.zoom, value.top, value.left, value.offset].every(
        Number.isFinite,
      )
    )
      return null;
    return {
      ...value,
      chapter: Math.max(0, Math.floor(value.chapter)),
      zoom: Math.max(0.5, Math.min(3, value.zoom)),
      top: Math.max(0, value.top),
      left: Math.max(0, value.left),
      offset: Math.max(0, Math.floor(value.offset)),
    };
  } catch {
    return null;
  }
}
