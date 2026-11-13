export type TextSessionManifest = { ids: string[]; active: string | null };
export function readTextSessionManifest(): TextSessionManifest {
  try {
    const raw = JSON.parse(localStorage.getItem("alder.txt.session") || "null");
    if (!raw || !Array.isArray(raw.ids)) return { ids: [], active: null };
    const ids = [
      ...new Set(
        raw.ids.filter(
          (id: unknown): id is string =>
            typeof id === "string" && /^[A-Za-z0-9][\w.-]{0,127}$/.test(id),
        ),
      ),
    ].slice(0, 32) as string[];
    return { ids, active: ids.includes(raw.active) ? raw.active : null };
  } catch {
    return { ids: [], active: null };
  }
}
