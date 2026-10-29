import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-references-"));
const directory = path.resolve("work/document-references");
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", checks: [] };
const stage = (value) => {
  report.stage = value;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
};
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Book", exact: false }).click();
  await page.getByLabel("Name", { exact: true }).fill("Reference manuscript");
  await page.getByLabel("Chapters", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.evaluate(async () => {
    const id = localStorage.getItem("alder.project"),
      project = await window.alder.request("GET", `/api/projects/${id}`);
    project.book.chapters[0].document = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, blockId: "heading-target" },
          content: [{ type: "text", text: "Original heading" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Body." }] },
      ],
    };
    project.book.chapters[1].document = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "bookmark",
              attrs: {
                name: "Passage",
                blockId: "passage-target",
                range: true,
              },
            },
            { type: "text", text: "Selected passage" },
            {
              type: "bookmark_end",
              attrs: { targetId: "passage-target", name: "Passage" },
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "See " }] },
      ],
    };
    await window.alder.request("PUT", `/api/projects/${id}`, {
      project,
      expectedRevision: project.revision,
    });
  });
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Reference manuscript" })
      .click();
  };
  await reopen();
  await page
    .getByRole("button", { name: "Open chapter Chapter 2", exact: true })
    .click();
  const menu = async (name) => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  const insert = async (target) => {
    await menu("Insert cross-reference…");
    const dialog = page.getByRole("dialog", {
      name: "Insert cross-reference",
      exact: true,
    });
    await dialog
      .getByLabel("Reference target", { exact: true })
      .selectOption(target);
    await dialog.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(editor).toBeFocused();
  };
  stage("insert references and undo");
  await editor.press("Control+End");
  await insert("heading-target");
  const heading = editor.locator('[data-cross-reference="heading-target"]');
  await expect(heading).toHaveText("Original heading");
  await editor.press("Control+z");
  await expect(heading).toHaveCount(0);
  await editor.press("Control+y");
  await expect(heading).toHaveCount(1);
  await editor.press("Control+End");
  await page.keyboard.type(" / ");
  await insert("passage-target");
  await expect(
    editor.locator('[data-cross-reference="passage-target"]'),
  ).toHaveText("Selected passage");
  report.checks.push(
    "Heading and passage insertion keeps focus, supports undo/redo, and displays the source wording.",
  );
  stage("source edit and project refresh");
  await heading.click({ modifiers: ["Control"] });
  await expect(editor.locator("h1")).toHaveText("Original heading");
  await editor.press("Control+Home");
  await editor.press("Shift+End");
  await page.keyboard.type("Renamed heading");
  await page
    .getByRole("button", { name: "Open chapter Chapter 2", exact: true })
    .click();
  await editor.press("Control+End");
  await menu("Update fields");
  await expect(heading).toHaveText("Renamed heading");
  await editor.press("Control+z");
  await expect(heading).toHaveText("Original heading");
  await editor.press("Control+y");
  await expect(heading).toHaveText("Renamed heading");
  await editor.focus();
  await page.keyboard.type("X");
  await expect(editor).toContainText("Selected passageX");
  await editor.press("Control+z");
  await expect(editor).not.toContainText("passageX");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await page
    .getByRole("button", { name: "Open chapter Chapter 2", exact: true })
    .click();
  await expect(heading).toHaveText("Renamed heading");
  report.checks.push(
    "Ctrl-click navigates across chapters; explicit project refresh and reopening keep current wording and caret.",
  );
  stage("clipboard identities");
  const copiedHTML = await editor.innerHTML();
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.evaluate((element, html) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData(
      "text/plain",
      "Selected passage\nSee Renamed heading / Selected passage",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, copiedHTML);
  await expect(
    editor.locator('[data-cross-reference="heading-target"]'),
  ).toHaveCount(2);
  await expect(
    editor.locator('[data-document-bookmark="Passage_2"]'),
  ).toHaveCount(1);
  const copied = await editor
    .locator('[data-document-bookmark="Passage_2"]')
    .getAttribute("data-bookmark-id");
  await expect(
    editor.locator(`[data-cross-reference="${copied}"]`),
  ).toHaveCount(1);
  await editor.press("Control+z");
  await expect(editor.locator("[data-cross-reference]")).toHaveCount(2);
  report.checks.push(
    "Copying a passage and its reference binds the copied reference independently while links to external headings retain their target.",
  );
  stage("missing source");
  await page
    .getByRole("button", { name: "Open chapter Chapter 1", exact: true })
    .click();
  await editor.fill("Target removed.");
  await page
    .getByLabel("Paragraph type", { exact: true })
    .selectOption("paragraph");
  await menu("Update fields");
  await page
    .getByRole("button", { name: "Open chapter Chapter 2", exact: true })
    .click();
  await expect(heading).toHaveText("Renamed heading");
  await expect(heading).toHaveAttribute("data-reference-unresolved", "true");
  await menu("Insert cross-reference…");
  await page.screenshot({ path: path.join(directory, "dialog.png") });
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
  report.checks.push(
    "Missing targets keep their last wording and are visibly marked; dialog cancels by keyboard.",
  );
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
