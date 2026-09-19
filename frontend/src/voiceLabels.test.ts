import { describe, expect, it } from "vitest";
import { voiceLanguageLabel } from "./voiceLabels";

describe("voice language labels", () => {
  it("uses familiar English accent names", () => {
    expect(voiceLanguageLabel("en-US")).toBe("American");
    expect(voiceLanguageLabel("en-GB")).toBe("English");
    expect(voiceLanguageLabel("en_AU")).toBe("Australian");
    expect(voiceLanguageLabel("en-gb-scotland")).toBe("Scottish");
    expect(voiceLanguageLabel("en-CA")).toBe("Canadian");
  });
  it("names other languages and handles missing or custom codes", () => {
    expect(voiceLanguageLabel("fr-CA")).toBe("Canadian French");
    expect(voiceLanguageLabel("de-DE")).toContain("German");
    expect(voiceLanguageLabel("cmn")).toBe("Mandarin Chinese");
    expect(voiceLanguageLabel()).toBe("");
    expect(voiceLanguageLabel("invalid-code-here")).toBe("Other language");
  });
});
