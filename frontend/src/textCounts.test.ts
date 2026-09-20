import { expect, it } from "vitest";
import { countSentences } from "./textCounts";

it("counts sentences and unfinished selections without counting blank text", () => {
  expect(countSentences(" \n\t")).toBe(0);
  expect(countSentences("First sentence. Second sentence! Last fragment")).toBe(
    3,
  );
  expect(countSentences("part of a sentence")).toBe(1);
  expect(countSentences("Hello!\n\nAnother paragraph.")).toBe(2);
  expect(countSentences("你好。世界！")).toBe(2);
});
