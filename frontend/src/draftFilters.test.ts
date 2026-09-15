import { describe, expect, it } from "vitest";
import { matchesDraftPeriod } from "./draftFilters";
const now = Date.parse("2026-09-15T12:00:00Z");
const edited = (days: number) => ({
  updatedAt: new Date(now - days * 86400000).toISOString(),
});
describe("draft edit periods", () => {
  it.each([
    ["Past Day", 1],
    ["Past Week", 7],
    ["Past Month", 30],
    ["Past Year", 365],
  ] as const)("uses the inclusive rolling boundary for %s", (period, days) => {
    expect(matchesDraftPeriod(edited(days), period, now)).toBe(true);
    expect(matchesDraftPeriod(edited(days + 0.001), period, now)).toBe(false);
    expect(matchesDraftPeriod(edited(0), period, now)).toBe(true);
  });
  it("uses last edit rather than creation and keeps undated drafts under All", () => {
    expect(
      matchesDraftPeriod(
        { createdAt: edited(100).updatedAt, ...edited(0.1) },
        "Past Day",
        now,
      ),
    ).toBe(true);
    expect(matchesDraftPeriod({}, "All", now)).toBe(true);
    expect(matchesDraftPeriod({}, "Past Day", now)).toBe(false);
    expect(matchesDraftPeriod({ updatedAt: "invalid" }, "Past Day", now)).toBe(
      false,
    );
  });
});
