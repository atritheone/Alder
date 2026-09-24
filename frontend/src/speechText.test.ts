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
describe("speech reference projection", () => {
  it("skips linked labels and their otherwise empty brackets by default", () => {
    const input = doc(plain("Read ("), link("Wikipedia"), plain(") next."));
    const out = speechText(input);
    expect(out.text).toBe("Read next.");
    expect(out.offsets[out.text.indexOf("next")]).toBe(17);
    expect(speechText(input, 0, 0, true).text).toBe("Read (Wikipedia) next.");
    expect(speechText(input)).toBe(out);
  });
  it("preserves normal bracketed wording and handles nested and split links", () => {
    expect(speechText(doc(plain("(see "), link("Wiki"), plain(")"))).text).toBe(
      "",
    );
    expect(
      speechText(
        doc(plain("[( "), link("Wiki"), link("pedia"), plain(" )] next")),
      ).text,
    ).toBe("next");
  });
  it("keeps Unicode and selection offsets aligned with source text", () => {
    const input = doc(plain("😀 "), link("Wiki"), plain(" fine"));
    const out = speechText(input, 3, 0);
    expect(out.text).toBe("fine");
    expect(out.offsets[out.text.indexOf("fine")]).toBe(5);
    expect(speechText(input, 4, 6).text).toBe("");
    expect(speechText(input, 0, 0, true).offsets.slice(0, 3)).toEqual([
      0, 2, 3,
    ]);
  });
  it("skips URL text and retains sentence punctuation", () => {
    expect(
      speechText(doc(plain("Read [https://example.com/a]. Next."))).text,
    ).toBe("Read. Next.");
  });
  it.each([
    "([Reuters][57])",
    "([PubMed Central (PMC)][2])",
    "[National Crime Agency][23]",
    "([First Source][1]; [Second Source][2])",
    "[Label](https://example.com/article_(one))",
    "[1, 3–5]",
    "(Smith, 2020)",
    "(Smith et al., 2020; Jones & Brown, 2021, pp. 4–6)",
    "[^note]",
  ])("omits an inline reference with no bibliography: %s", (citation) => {
    const source = `A finding ${citation}, followed by another.`;
    const out = speechText(doc(plain(source)));
    expect(out.text).toBe("A finding, followed by another.");
    for (const word of out.text.matchAll(/\p{L}+/gu)) {
      expect(
        source.slice(
          out.offsets[word.index],
          out.endOffsets[word.index + word[0].length],
        ),
      ).toBe(word[0]);
    }
    expect(speechText(doc(plain(source)), 0, 0, true).text).toBe(source);
  });
  it.each([
    "The name means (sleep) and (to bear).",
    "Convert (S)-reticuline into (R)-reticuline.",
    "The election (2026) followed a meeting (in 2025).",
    "The agreement (May 2020) was signed.",
    "Read [the next chapter] and (a short explanation).",
    "The formula is x = [1, 2] and f(1) = 4.",
  ])("retains substantive bracketed text: %s", (source) => {
    expect(speechText(doc(plain(source))).text).toBe(source);
  });
  it("omits source definitions, titles and footnote continuation text", () => {
    const source =
      'Text ([Source][one]) continues.[^note]\n\n[one]: https://example.com "A source title"\n[^note]: Explanation of the source.\n  Continued explanation.';
    expect(speechText(doc(plain(source))).text).toBe("Text continues.");
  });
  it("omits a bibliography only until the next same-level heading", () => {
    const paragraph = (text: string) =>
      schema.node("paragraph", null, [plain(text)]);
    const heading = (text: string) =>
      schema.node("heading", { level: 2 }, [plain(text)]);
    const input = schema.node("doc", null, [
      paragraph("Evidence (1)."),
      heading("References"),
      paragraph("1. Smith, 2020. A source title."),
      heading("Appendix"),
      paragraph("More substantive text."),
    ]);
    const out = speechText(input);
    expect(out.text).toContain("Evidence.");
    expect(out.text).not.toMatch(/References|Smith|source title/);
    expect(out.text).toContain("Appendix\nMore substantive text.");
  });
  it("retains literal code and mathematical superscripts", () => {
    const input = schema.node("doc", null, [
      schema.node("code_block", null, [plain("array[1] ([Source][2])")]),
      schema.node("paragraph", null, [
        plain("x"),
        schema.text("2", [schema.marks.superscript.create()]),
      ]),
    ]);
    expect(speechText(input).text).toBe("array[1] ([Source][2])\nx2");
  });
  it("uses the entire document to recognise a citation inside a partial selection", () => {
    const source = "😀 Before ([Publisher (PMC)][2]) after.";
    const start = source.indexOf("Publisher") + 2;
    const out = speechText(
      doc(plain(source)),
      start,
      source.indexOf("after") + 5,
    );
    expect(out.text).toBe("after");
    expect(start + out.offsets[0]).toBe(source.indexOf("after"));
    expect(start + out.endOffsets[5]).toBe(source.indexOf("after") + 5);
  });
  it("separates remaining words and preserves real paragraph boundaries", () => {
    expect(
      speechText(doc(plain("One[1]two.\n\nThree ([Source][2])."))).text,
    ).toBe("One two.\n\nThree.");
  });
  it("does not leave pauses from citation separators or duplicate full stops", () => {
    expect(
      speechText(doc(plain("One [1], [2]; [3]. Next. ([Source][4]). Last.")))
        .text,
    ).toBe("One. Next. Last.");
  });
});
