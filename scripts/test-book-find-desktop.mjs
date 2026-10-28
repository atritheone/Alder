import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-book-find-"));
const report = "work/book-find-report.json";
const checks = [];
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 1000);
    win.show();
    win.focus();
  });
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Book", exact: false }).click();
  await page.getByLabel("Name", { exact: true }).fill("Search fixture");
  await page.getByLabel("Chapters", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const toolbar = page.locator(".book-main .format-toolbar");
  const openChapter = (number) =>
    page
      .getByRole("button", {
        name: `Open chapter Chapter ${number}`,
        exact: true,
      })
      .click();
  await editor.fill("cat first cat");
  await editor.press("ControlOrMeta+a");
  await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
  await openChapter(2);
  await editor.fill("cat second");
  await page.getByLabel("Include in book", { exact: true }).uncheck();
  await openChapter(3);
  await editor.fill("Untouched wording");
  await openChapter(1);
  await editor.press("ControlOrMeta+Home");
  await editor.press("ControlOrMeta+Shift+ArrowRight");
  await editor.press("ControlOrMeta+f");
  const find = page.getByRole("complementary", {
    name: "Find and replace",
    exact: true,
  });
  await find.getByRole("searchbox", { name: "Find text" }).fill("cat");
  await find.getByLabel("Search scope").selectOption("book");
  await expect(find.getByRole("status")).toHaveText("3 matches");
  for (let count = 0; count < 3; count++)
    await find.getByRole("button", { name: "Next match" }).click();
  await expect(editor).toHaveText("cat second");
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("cat");
  await expect(find.getByRole("status")).toHaveText("3 of 3 matches");
  await find.getByLabel("Search scope").selectOption("chapter");
  await expect(find.getByLabel("Original selection only")).toHaveCount(0);
  await expect(find.getByRole("status")).toHaveText("1 matches");
  await find.getByLabel("Search scope").selectOption("book");
  await find.getByRole("textbox", { name: "Replacement text" }).fill("tiger");
  await find.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(editor).toHaveText("tiger second");
  await expect(find.getByRole("status")).toHaveText("No matches");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await expect(page.locator(".status-hint")).toContainText(
    "Replaced 3 matches across 2 chapters",
  );
  await openChapter(1);
  await expect(editor.locator("strong")).toHaveText("tiger first tiger");
  await openChapter(3);
  await expect(editor).toHaveText("Untouched wording");
  checks.push(
    "whole-book search navigates and selects; original selection does not leak to another chapter; excluded chapters included; replacement preserves formatting",
  );
  await page
    .getByRole("button", { name: "Undo project change", exact: true })
    .click();
  await openChapter(2);
  await expect(editor).toHaveText("cat second");
  await openChapter(1);
  await expect(editor.locator("strong")).toHaveText("cat first cat");
  await expect(find.getByRole("status")).toHaveText("3 matches");
  checks.push(
    "whole-book replacement restores all chapters with one project undo",
  );
  await find.locator("summary").click();
  await find.getByLabel("Regular expression", { exact: true }).check();
  await find.getByRole("searchbox", { name: "Find text" }).fill("(c)(at)");
  await find.getByRole("textbox", { name: "Replacement text" }).fill("$2$1");
  await expect(find.getByRole("status")).toHaveText("3 matches");
  await expect(find.getByLabel("Replacement preview")).toContainText("atc");
  await find.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(editor).toHaveText("atc first atc");
  await openChapter(2);
  await expect(editor).toHaveText("atc second");
  await page
    .getByRole("button", { name: "Undo project change", exact: true })
    .click();
  await expect(editor).toHaveText("cat second");
  await find.getByLabel("Regular expression", { exact: true }).uncheck();
  await find.getByRole("searchbox", { name: "Find text" }).fill("cat");
  await expect(find.getByRole("status")).toHaveText("3 matches");
  checks.push(
    "whole-book capture replacements agree with the preview and restore together with project undo",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .getByRole("button", { name: "Search fixture", exact: false })
    .click();
  await openChapter(2);
  await expect(editor).toHaveText("cat second");
  await expect(
    page.getByLabel("Include in book", { exact: true }),
  ).not.toBeChecked();
  checks.push("reopening retains restored text and excluded chapter state");
  expect(errors).toEqual([]);
  fs.writeFileSync(
    report,
    JSON.stringify({ status: "passed", checks, errors }, null, 2),
  );
} catch (error) {
  const content = await page
    ?.locator("body")
    .innerText()
    .catch(() => "Unavailable");
  fs.writeFileSync(
    report,
    JSON.stringify(
      { status: "failed", checks, error: error.stack, content },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close();
}
