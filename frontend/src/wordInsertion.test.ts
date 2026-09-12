import { expect, test } from "vitest";
import { spacedWord } from "./wordInsertion";

test("dragged words build a sentence without doubled spaces", () => {
  let text = "";
  for (const word of ["I", "want", "to", "write"])
    text += spacedWord(word, text, "");
  expect(text).toBe("I want to write ");
});
test("insertion separates neighbouring words and respects punctuation", () => {
  expect(spacedWord("really", "I", "want")).toBe(" really ");
  expect(spacedWord("really", "I ", " want")).toBe("really");
  expect(spacedWord("word", "(", ")")).toBe("word");
  expect(spacedWord("word", "a ", ", next")).toBe("word");
});
