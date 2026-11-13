import { it, expect } from "vitest";
import { decodeSearchEscapes } from "./searchEscapes";
it("decodes extended literal escapes without regex interpretation", () => {
  expect(decodeSearchEscapes("a\\n\\t\\x41\\u00e9\\\\.*")).toEqual({
    text: "a\n\tAé\\.*",
  });
  expect(decodeSearchEscapes("\\xG0").error).toBeTruthy();
  expect(decodeSearchEscapes("end\\").error).toBeTruthy();
  expect(decodeSearchEscapes("\\w").error).toBeTruthy();
});
