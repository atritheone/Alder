import { it, expect } from "vitest";
import { repeatingTableHeaders } from "./repeatingTableHeaders";

const header = (rowspan = 1) => ({ header: true, rowspan });
const body = () => ({ header: false, rowspan: 1 });
it("repeats complete header bands and keeps merges into body rows in the body grid", () => {
  expect(repeatingTableHeaders([[header(2), header()], [header()], [body(), body()]])).toBe(2);
  expect(repeatingTableHeaders([[header(2), header()], [body()], [body(), body()]])).toBe(0);
  expect(repeatingTableHeaders([[header(), header()], [header(2), header()], [body()], [body(), body()]])).toBe(1);
  expect(repeatingTableHeaders([[header(), header()]])).toBe(0);
});
