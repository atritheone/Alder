import { expect, it } from "vitest";
import { proofreadingHoverIssue } from "./proofreadingHover";
import type { Annotation } from "./types";

const word: Annotation = {
  id: "word",
  type: "grammar",
  start: 12,
  end: 17,
  rule: "agreement",
  message: "Agreement",
};
const sentence: Annotation = {
  id: "sentence",
  type: "clarity",
  kind: "sentence-revision",
  start: 0,
  end: 40,
  rule: "revision",
  message: "Rewrite",
};
it("offers the complete revision when hovering a nested grammar underline", () => {
  expect(proofreadingHoverIssue([word, sentence], "word")).toBe(sentence);
});
it("keeps a word correction when no sentence rewrite covers it", () => {
  expect(
    proofreadingHoverIssue([word, { ...sentence, start: 20 }], "word"),
  ).toBe(word);
});
it("does not revive an underline from an obsolete result", () => {
  expect(proofreadingHoverIssue([sentence], "obsolete")).toBeUndefined();
});
