import type { Clip } from "./types";

export const draftPeriods = [
  "All",
  "Past Day",
  "Past Week",
  "Past Month",
  "Past Year",
];
const periodDays: Record<string, number> = {
  "Past Day": 1,
  "Past Week": 7,
  "Past Month": 30,
  "Past Year": 365,
};

/** Rolling periods based on the draft's last edit, not unrelated project saves. */
export function matchesDraftPeriod(
  draft: Pick<Clip, "updatedAt" | "createdAt">,
  period: string,
  now = Date.now(),
): boolean {
  if (period === "All") return true;
  const days = periodDays[period];
  const edited = Date.parse(draft.updatedAt || draft.createdAt || "");
  return (
    !!days &&
    Number.isFinite(edited) &&
    edited >= now - days * 86400000 &&
    edited <= now
  );
}
