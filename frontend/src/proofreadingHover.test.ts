import { expect, it } from "vitest";
import {
  proofreadingHoverIssue,
  proofreadingHoverCandidates,
  proofreadingPointerIssue,
} from "./proofreadingHover";
import type { Annotation } from "./types";

const word: Annotation = {
  id: "word",
  type: "spelling",
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
it("keeps spelling selectable instead of replacing it with the sentence revision", () => {
  expect(proofreadingHoverIssue([word, sentence], "word")).toBe(word);
  expect(proofreadingHoverCandidates([word, sentence], word)).toEqual([
    word,
    sentence,
  ]);
  expect(proofreadingHoverCandidates([word, sentence], sentence)).toEqual([
    word,
    sentence,
  ]);
});
it("keeps a word correction when no sentence rewrite covers it", () => {
  expect(
    proofreadingHoverIssue([word, { ...sentence, start: 20 }], "word"),
  ).toBe(word);
});
it("does not revive an underline from an obsolete result", () => {
  expect(proofreadingHoverIssue([sentence], "obsolete")).toBeUndefined();
});
it("resolves spelling even when overlapping DOM attributes kept only the sentence id", () => {
  expect(proofreadingPointerIssue([word, sentence], ["sentence", "word"])).toBe(
    word,
  );
  expect(proofreadingPointerIssue([word, sentence], ["sentence"])).toBe(
    sentence,
  );
});
it("excludes adjacent sentences and includes insertion fixes inside this sentence", () => {
  const next = { ...sentence, id: "next", start: 40, end: 70 };
  const insertion = {
    ...word,
    id: "insert",
    type: "punctuation",
    start: 18,
    end: 18,
  };
  expect(
    proofreadingHoverCandidates([next, word, sentence, insertion], word),
  ).toEqual([word, sentence, insertion]);
});
