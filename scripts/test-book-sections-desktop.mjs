import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = path.resolve("work/book-sections-ui");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-book-sections-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const id = await page.evaluate(async () => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Chapter sections",
      template: "blank",
    });
    const paragraph = (text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
    const chapter = (id, content, include = true) => ({
      id,
      title: id,
      include,
      document: { type: "doc", content },
    });
    Object.assign(p.settings, {
      documentKind: "book",
      pageSize: "A4",
      includeTitle: false,
      includeToc: false,
      chapterPageBreaks: true,
      footer: false,
    });
    p.book = {
      version: 1,
      chapters: [
        chapter("First", [
          paragraph("FIRST_BODY"),
          {
            type: "section_break",
            attrs: {
              kind: "nextPage",
              page: {
                pageSize: "A5",
                orientation: "landscape",
                marginMm: 16,
                columns: { count: 2, gapMm: 8, separator: true },
              },
              runningMatter: {
                header: {
                  default: {
                    type: "doc",
                    content: [paragraph("INHERITED_HEADER")],
                  },
                },
              },
            },
          },
          paragraph("FIRST_SECTION"),
        ]),
        chapter(
          "Excluded",
          [
            {
              type: "section_break",
              attrs: { kind: "nextPage", page: { pageSize: "Legal" } },
            },
            paragraph("EXCLUDED_BODY"),
          ],
          false,
        ),
        chapter("Second", [
          paragraph("SECOND_BODY ".repeat(160)),
          {
            type: "section_break",
            attrs: {
              kind: "nextPage",
              page: { pageSize: "Letter", marginMm: 20 },
            },
          },
          paragraph("SECOND_LETTER"),
        ]),
        chapter("Third", [paragraph("THIRD_BODY")]),
      ],
    };
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  });
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Chapter sections" })
      .click();
  };
  await reopen();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const sheets = page.locator(".page-sheets > .page-sheet");
  const open = (name) =>
    page
      .getByRole("button", { name: `Open chapter ${name}`, exact: true })
      .click();
  const size = (index) =>
    sheets
      .nth(index)
      .evaluate((e) =>
        [parseFloat(e.style.width), parseFloat(e.style.height)].map((x) =>
          Math.round((x * 25.4) / 96),
        ),
      );
  await open("Second");
  await expect(editor).toContainText("SECOND_BODY");
  await expect.poll(() => size(0)).toEqual([210, 148]);
  await expect(
    sheets.first().locator("[data-running-story=header]"),
  ).toHaveText("INHERITED_HEADER");
  await expect(editor).toHaveAttribute("data-column-layout", "");
  const secondPages = await sheets.count();
  await open("Third");
  await expect.poll(() => size(0)).toEqual([216, 279]);
  await expect(editor).not.toHaveAttribute("data-column-layout");
  await open("First");
  await expect.poll(() => size(0)).toEqual([210, 297]);
  await editor.locator("p").filter({ hasText: "FIRST_SECTION" }).click();
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Section properties…", exact: true })
    .click();
  const section = page.getByRole("dialog", { name: "Section", exact: true });
  await section.getByLabel("Section paper", { exact: true }).selectOption("A4");
  await section.getByRole("button", { name: "Apply", exact: true }).click();
  await open("Second");
  await expect.poll(() => size(0)).toEqual([297, 210]);
  await open("First");
  await editor.press("Control+z");
  await open("Second");
  await expect.poll(() => size(0)).toEqual([210, 148]);
  await expect(sheets).toHaveCount(secondPages);
  for (const scale of ["0.5", "1", "1.5"]) {
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings.getByLabel("UI Scale", { exact: true }).selectOption(scale);
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await expect.poll(() => size(0)).toEqual([210, 148]);
    await expect(sheets).toHaveCount(secondPages);
  }
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await open("Second");
  await expect.poll(() => size(0)).toEqual([210, 148]);
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(secondPages);
  const miniature = page.locator(".page-miniature").first();
  expect(
    await miniature.evaluate(
      (e) => parseFloat(e.style.width) / parseFloat(e.style.height),
    ),
  ).toBeCloseTo(210 / 148);
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  const pdf = await page.evaluate(async (id) => {
    const result = await window.alder.request(
      "POST",
      `/api/projects/${id}/export`,
      { format: "pdf" },
    );
    return {
      result,
      bytes: [
        ...new Uint8Array(
          await (
            await fetch(window.alder.mediaBase + result.downloadUrl)
          ).arrayBuffer(),
        ),
      ],
    };
  }, id);
  fs.writeFileSync(path.join(directory, "book.pdf"), Buffer.from(pdf.bytes));
  report.pdf = pdf.result;
  report.secondPages = secondPages;
  await page.screenshot({ path: path.join(directory, "second.png") });
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  process.exitCode = 1;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
