import { validRevisionStamp } from "./trackedChanges";
import type { BlockMove } from "./trackedBlockMoves";

/** Complete inserted/deleted paragraphs, used by document comparison. */
export function validBlockChange(value: unknown): value is BlockMove {
  const change = value as BlockMove;
  return (
    !!change &&
    ["insertion", "deletion"].includes(change.kind) &&
    validRevisionStamp(change.stamp) &&
    !change.stamp.move &&
    (change.originalId === null ||
      (typeof change.originalId === "string" &&
        /^[A-Za-z0-9_.-]{1,128}$/.test(change.originalId))) &&
    Number.isInteger(change.count ?? 1) && (change.count ?? 1)>=1 && (change.count ?? 1)<=100000 &&
    Number.isInteger(change.part ?? 0) && (change.part ?? 0)>=0 && (change.part ?? 0)<(change.count ?? 1)
  );
}
export function parseBlockChange(value: string | null): BlockMove | null {
  if (value === null) return null;
  const change = JSON.parse(value);
  if (!validBlockChange(change))
    throw Error("Invalid tracked paragraph change.");
  return change;
}
