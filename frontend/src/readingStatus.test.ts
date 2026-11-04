import { expect, it } from "vitest";
import { indexWords } from "./readingEstimate";
import {
  readingStatus,
  readingStatusKey,
  type ReadingStatusContext,
} from "./readingStatus";
const text = "word ".repeat(1000);
const context: ReadingStatusContext = {
  chapterIds: ["first", "second"],
  wordIndexes: [indexWords(text), indexWords("Last chapter.")],
  selection: null,
  playing: true,
  raw: false,
  speed: 1,
};
const position = { chapterId: "first", offset: 0, length: text.length };

it("retains ordinary word positions without repainting unchanged status", () => {
  expect(readingStatusKey(position, context, 0)).toBe(
    readingStatusKey({ ...position, offset: 5 }, context, 0),
  );
  expect(readingStatusKey(position, context, 0)).not.toBe(
    readingStatusKey({ ...position, offset: 5 }, context, 1),
  );
  expect(readingStatusKey(position, context, 0)).not.toBe(
    readingStatusKey({ ...position, offset: 50 }, context, 0),
  );
  expect(readingStatusKey(position, context, 0)).not.toBe(
    readingStatusKey(null, context, null),
  );
});

it("retains exact remaining estimates across chapters, speed changes, selection and pause", () => {
  expect(readingStatus(position, context)).toEqual({
    remaining: true,
    estimate: "≈\u00a00:06",
    progress: "0%",
  });
  const middle = { ...position, offset: 2500 };
  expect(readingStatus(middle, context).estimate).toBe("≈\u00a00:03");
  expect(readingStatus(middle, { ...context, speed: 2 }).estimate).toBe(
    "≈\u00a00:02",
  );
  expect(readingStatus(middle, { ...context, playing: false }).estimate).toBe(
    "≈\u00a00:06",
  );
  expect(readingStatus(middle, { ...context, raw: true }).remaining).toBe(
    false,
  );
  const selected = {
    ...context,
    selection: { chapterId: "first", words: 200, start: 2000, end: 3000 },
  };
  expect(readingStatus(middle, selected).estimate).toBe("≈\u00a00:01");
  expect(readingStatus(middle, { ...selected, playing: false }).estimate).toBe(
    "≈\u00a00:02",
  );
  expect(
    readingStatus({ chapterId: "second", offset: 5, length: 13 }, context)
      .estimate,
  ).toBe("≈\u00a00:01");
});
