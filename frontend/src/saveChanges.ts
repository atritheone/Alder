import type { Project } from "./types";
export type SaveReply = {
  savedRevision: number;
  changes: { path: (string | number)[]; value?: unknown; remove?: boolean }[];
};
/** Apply only to the exact immutable request snapshot, never a newer edit. */
export function canonicalSaved(
  snapshot: Project,
  reply: SaveReply | Project,
): Project {
  if (!("savedRevision" in reply)) return reply;
  let saved = snapshot;
  for (const change of reply.changes) {
    if (!change.path.length) throw Error("Invalid save correction path.");
    const root = { ...saved };
    let target: any = root,
      source: any = saved;
    for (const [index, key] of change.path.entries()) {
      if (index === change.path.length - 1) {
        if (change.remove) delete target[key];
        else
          Object.defineProperty(target, key, {
            value: change.value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
      } else {
        if (
          !Object.hasOwn(source, key) ||
          source[key] === null ||
          typeof source[key] !== "object"
        )
          throw Error("Invalid save correction parent.");
        source = source[key];
        Object.defineProperty(target, key, {
          value: Array.isArray(source) ? [...source] : { ...source },
          enumerable: true,
          configurable: true,
          writable: true,
        });
        target = target[key];
      }
    }
    saved = root;
  }
  if (
    saved.id !== snapshot.id ||
    saved.revision !== reply.savedRevision ||
    !Number.isInteger(reply.savedRevision)
  )
    throw Error("Invalid saved revision.");
  return saved;
}
