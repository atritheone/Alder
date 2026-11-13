import { test, expect } from "@playwright/test";
import path from "node:path";
import os from "node:os";

test.use({ launchOptions: { channel: "msedge" } });
test("TXT retains shared Write chrome and typography; TXT tools stay scoped", async ({
  browser,
}) => {
  const results: Record<string, unknown>[] = [];
  for (const kind of ["txt", "docx", "book"]) {
    const context = await browser.newContext({
        viewport: { width: 1600, height: 1000 },
      }),
      page = await context.newPage();
    await page.goto(process.env.ALDER_TXT_TEST_URL || "http://127.0.0.1:4173");
    await page.getByRole("button", { name: "New", exact: true }).click();
    if (kind === "docx")
      await page
        .getByRole("button", { name: "Word document .docx", exact: true })
        .click();
    if (kind === "book")
      await page
        .getByRole("button", { name: "Book Chapters & pages", exact: true })
        .click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Write appearance " + kind);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const editor =
      kind === "txt"
        ? page.getByRole("textbox", { name: "TXT text editor", exact: true })
        : page.getByRole("textbox", {
            name: "Chapter text editor",
            exact: true,
          });
    await expect(editor).toBeVisible();
    await editor.fill(
      "Alder keeps the same writing space.\nThe text editor adds useful tools without changing the workspace.",
    );
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".book-editor .format-toolbar")).toBeVisible();
    if (kind === "txt") {
      await expect(
        page.getByRole("button", { name: "Text tools", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Choose folder", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Split view", exact: true }),
      ).not.toBeVisible();
    } else {
      await expect(
        page.getByRole("button", { name: "Text tools", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Line numbers", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Word wrap", exact: true }),
      ).toHaveCount(0);
    }
    results.push(
      await page.evaluate((kind) => {
        const toolbar = document.querySelector(".book-editor .format-toolbar")!,
          text = document.querySelector(
            kind === "txt"
              ? ".book-editor .cm-content"
              : ".book-editor .ProseMirror",
          )!,
          style = getComputedStyle(text),
          gutter = document.querySelector(".book-editor .cm-gutters"),
          paper = document.querySelector(".book-editor .page-sheet");
        let scale = 1;
        for (
          let parent: Element | null = text;
          parent;
          parent = parent.parentElement
        ) {
          const s = getComputedStyle(parent);
          if (s.transform !== "none")
            scale *= new DOMMatrixReadOnly(s.transform).a;
          scale *= parseFloat(s.zoom) || 1;
        }
        return {
          kind,
          toolbarHeight: toolbar.getBoundingClientRect().height,
          font: style.fontFamily,
          size: Math.round(parseFloat(style.fontSize) * scale * 100) / 100,
          paperWidth: paper
            ? paper.getBoundingClientRect().width
            : text.getBoundingClientRect().width +
              (gutter?.getBoundingClientRect().width || 0),
        };
      }, kind),
    );
    await page.screenshot({
      path: path.join(os.tmpdir(), `alder-write-${kind}-appearance.png`),
    });
    await context.close();
  }
  console.log(JSON.stringify(results));
  expect(results[0].font).toBe(results[1].font);
  expect(results[0].size).toBe(results[1].size);
  expect(
    Math.abs(
      Number(results[0].toolbarHeight) - Number(results[1].toolbarHeight),
    ),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(Number(results[0].paperWidth) - Number(results[1].paperWidth)),
  ).toBeLessThanOrEqual(2);
});
