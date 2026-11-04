import { expect, it } from "vitest";
import {
  sameSheetPages,
  samePagePresentation,
  type PagePresentation,
} from "./pagePresentation";

const fixture = (): PagePresentation => ({
  pages: [
    { from: 0, to: 20, text: "First sheet" },
    {
      from: 20,
      to: 40,
      text: "Second sheet",
      frame: {
        top: 728,
        left: 0,
        layout: {
          width: 500,
          height: 700,
          margin: 40,
          zoom: 1,
          lineHeight: 1.5,
          footer: true,
        },
      },
    },
  ],
  headers: ["", "<p>Repeated table heading</p>"],
  layout: { width: 500, height: 700, margin: 40, zoom: 1, lineHeight: 1.5 },
});

it("retains sheet presentation while the complete page map keeps new text and positions", () => {
  const original = fixture(),
    edited = structuredClone(original);
  edited.pages[0].text = "Changed wording";
  edited.pages[0].to++;
  edited.pages[1].from++;
  edited.pages[1].to++;
  expect(samePagePresentation(original, edited)).toBe(true);
  expect(edited.pages[1].from).not.toBe(original.pages[1].from);
  expect(sameSheetPages(original.pages, structuredClone(original.pages))).toBe(
    true,
  );
});

it("invalidates every independently painted part of a sheet", () => {
  const original = fixture();
  const changes: ((p: PagePresentation) => void)[] = [
    (p) => {
      p.pages.push({ from: 40, to: 50, text: "Third sheet" });
    },
    (p) => {
      p.pages[0].to = p.pages[0].from;
    },
    (p) => {
      p.headers[1] = "Changed table heading";
    },
    (p) => {
      p.pages[1].frame!.top++;
    },
    (p) => {
      p.pages[1].frame!.left++;
    },
    (p) => {
      p.pages[1].frame!.layout.width++;
    },
    (p) => {
      p.pages[1].frame!.layout.pageNumberOffset = 9;
    },
    (p) => {
      p.pages[1].frame!.layout.runningHeadings = {
        heading1: "Changed heading",
      };
    },
    (p) => {
      p.pages[1].noteHTML = "<p>Continued note</p>";
    },
    (p) => {
      p.pages[1].columnRules = [{ x: 200, top: 40, bottom: 600 }];
    },
    (p) => {
      p.pages[1].lineNumbers = [
        { x: 20, y: 50, number: 1, fontFamily: "Cambria" },
      ];
    },
    (p) => {
      p.layout.margin++;
    },
    (p) => {
      p.layout.footer = true;
    },
  ];
  for (const change of changes) {
    const edited = structuredClone(original);
    change(edited);
    expect(samePagePresentation(original, edited), change.toString()).toBe(
      false,
    );
  }
});

it("compares nested running stories by value without allocating serialized copies", () => {
  const original = fixture();
  original.layout.runningStyles = [
    { id: "header", name: "Header", fontFamily: "Cambria" },
  ];
  expect(samePagePresentation(original, structuredClone(original))).toBe(true);
  const edited = structuredClone(original);
  edited.layout.runningStyles![0].fontFamily = "Arial";
  expect(samePagePresentation(original, edited)).toBe(false);
});
