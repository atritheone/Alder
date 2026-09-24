import { describe, it, expect } from "vitest";
import { schema } from "./Editor";
import { speechText } from "./speechText";
const plain = (text: string) => schema.text(text);
const link = (text: string) =>
  schema.text(text, [
    schema.marks.link.create({ href: "https://example.com/long-url" }),
  ]);
const doc = (...nodes: ReturnType<typeof plain>[]) =>
  schema.node("doc", null, [schema.node("paragraph", null, nodes)]);
describe("speech hyperlink projection", () => {
  it("skips linked labels and their otherwise empty brackets by default", () => {
    const input = doc(plain("Read ("), link("Wikipedia"), plain(") next."));
    const out = speechText(input);
    expect(out.text).toBe("Read   next.");
    expect(out.offsets[out.text.indexOf("next")]).toBe(17);
    expect(speechText(input, 0, 0, true).text).toBe("Read (Wikipedia) next.");
    expect(speechText(input)).toBe(out);
  });
  it("preserves normal bracketed wording and handles nested and split links", () => {
    expect(speechText(doc(plain("(see "), link("Wiki"), plain(")"))).text).toBe(
      "(see  )",
    );
    expect(
      speechText(
        doc(plain("[( "), link("Wiki"), link("pedia"), plain(" )] next")),
      ).text,
    ).toBe("  next");
  });
  it("keeps Unicode and selection offsets aligned with source text", () => {
    const input = doc(plain("😀 "), link("Wiki"), plain(" fine"));
    const out = speechText(input, 3, 0);
    expect(out.text).toBe("  fine");
    expect(out.offsets[out.text.indexOf("fine")]).toBe(5);
    expect(speechText(input, 4, 6).text).toBe(" ");
    expect(speechText(input, 0, 0, true).offsets.slice(0, 3)).toEqual([
      0, 2, 3,
    ]);
  });
  it("skips URL text and retains sentence punctuation", () => {
    expect(
      speechText(doc(plain("Read [https://example.com/a]. Next."))).text,
    ).toBe("Read  . Next.");
  });
});
