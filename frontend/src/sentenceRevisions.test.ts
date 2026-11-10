import { expect, it } from "vitest";
import { rebaseRevisions, sentenceRange } from "./sentenceRevisions";
import type { Annotation } from "./types";

it("targets the caret sentence rather than the whole paragraph", () => {
  const text = "First sentence. This needs work. Last one.";
  const range = sentenceRange(text, 22);
  expect(text.slice(range.start, range.end)).toBe("This needs work.");
});
it("retains and maps revisions only when their paragraph context is unchanged and unique", () => {
  const item: Annotation = {
    id: "a",
    type: "clarity",
    start: 0,
    end: 9,
    rule: "model:sentence-revision",
    message: "Review",
    alternatives: [
      {
        label: "Accept",
        edits: [
          {
            start: 0,
            end: 9,
            originalText: "Sentence.",
            replacement: "A sentence.",
          },
        ],
      },
    ],
  };
  const mapped = rebaseRevisions(
    [item],
    "Sentence.\nOther.",
    "New paragraph.\nSentence.\nOther.",
  );
  expect(mapped[0].start).toBe(15);
  expect(mapped[0].alternatives![0].edits[0].start).toBe(15);
  expect(rebaseRevisions([item], "Sentence.", "Changed sentence.")).toEqual([]);
  expect(rebaseRevisions([item], "Sentence.", "Sentence.\nSentence.")).toEqual(
    [],
  );
});
it("invalidates language-only changes without invalidating unrelated offset shifts", () => {
  const item: Annotation = {
    id: "a",
    type: "clarity",
    start: 0,
    end: 9,
    rule: "revision",
    message: "Review",
  };
  expect(
    rebaseRevisions(
      [item],
      "Sentence.",
      "Sentence.",
      '[{"start":0,"end":9,"language":"en-AU"}]',
      '[{"start":0,"end":9,"language":"fr"}]',
    ),
  ).toEqual([]);
  const rebased = rebaseRevisions(
    [item],
    "Sentence.",
    "New.\nSentence.",
    '[{"start":0,"end":9,"language":"en-AU"}]',
    '[{"start":0,"end":5,"language":"en-AU"},{"start":5,"end":14,"language":"en-AU"}]',
  );
  expect(rebased[0].start).toBe(5);
});
