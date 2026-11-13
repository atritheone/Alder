import { it, expect } from "vitest";
import { toolbarSupports, formatActionSupported } from "./documentCapabilities";
it("scopes text tools to TXT and rich tools to formats that retain them", () => {
  expect(toolbarSupports("txt", "txt-tools")).toBe(true);
  for (const type of [
    "docx",
    "book",
    "odt",
    "rtf",
    "md",
    "html",
    "alder",
  ] as const)
    expect(toolbarSupports(type, "txt-tools")).toBe(false);
  expect(toolbarSupports("txt", "emphasis")).toBe(false);
  expect(toolbarSupports("docx", "emphasis")).toBe(true);
  expect(toolbarSupports("md", "emphasis")).toBe(true);
  for (const feature of [
    "images",
    "tables",
    "font-format",
    "underline",
    "review",
  ] as const)
    expect(toolbarSupports("md", feature)).toBe(false);
  expect(toolbarSupports("rtf", "review")).toBe(false);
  expect(toolbarSupports("odt", "review")).toBe(false);
  expect(toolbarSupports("book", "review")).toBe(true);
});
it("hides unsupported metadata commands in the formatting overflow menu", () => {
  for (const type of ["odt", "rtf", "html", "md"] as const) {
    for (const label of [
      "Review changes…",
      "Comments…",
      "Insert form field…",
      "Index entries…",
    ])
      expect(formatActionSupported(type, label)).toBe(false);
    expect(formatActionSupported(type, "Insert link…")).toBe(true);
  }
  expect(formatActionSupported("docx", "Review changes…")).toBe(true);
  expect(formatActionSupported("book", "Insert form field…")).toBe(true);
});
