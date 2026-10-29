import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-revisions-")),
  directory = path.resolve("work/document-revisions");
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", checks: [] };
let app, page;
const stage = (value) => {
  report.stage = value;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
};
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Tracked manuscript");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    dialog = page.getByRole("dialog", { name: "Review changes", exact: true });
  const open = async () => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Review changes…", exact: true })
      .click();
  };
  const close = async () => {
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(editor).toBeFocused();
    await editor.evaluate(() => new Promise(requestAnimationFrame));
  };
  const select = async (selector, from, to) =>
    editor.locator(selector).evaluate(
      async (el, { from, to }) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const node = walker.nextNode();
        getSelection().setBaseAndExtent(node, from, node, to);
        await new Promise(requestAnimationFrame);
      },
      { from, to },
    );
  stage("tracked typing");
  await editor.fill("Old wording.");
  await open();
  await dialog.getByLabel("Review author", { exact: true }).fill("Writer");
  await dialog.getByLabel("Track changes", { exact: true }).check();
  await close();
  await select("p", 0, 3);
  await editor.pressSequentially("New", { delay: 30 });
  await expect(editor.locator("[data-revision-deletion]")).toHaveText("Old");
  await expect(editor.locator("[data-revision-insertion]")).toHaveText("New");
  const insertionId = await editor
    .locator("[data-revision-insertion]")
    .getAttribute("data-revision-insertion");
  const copiedHTML = await editor.innerHTML();
  report.checks.push(
    "Typing a replacement retains deleted words and groups the new wording.",
  );
  stage("independent formatting and previews");
  await open();
  await dialog.getByLabel("Review author", { exact: true }).fill("Editor");
  await close();
  await select("[data-revision-insertion]", 0, 3);
  expect(await page.evaluate(() => getSelection().toString())).toBe("New");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(editor.locator("[data-revision-format]")).toHaveCount(1);
  await open();
  await dialog
    .getByLabel("Review preview", { exact: true })
    .selectOption("original");
  await expect(
    dialog.getByLabel("original document preview", { exact: true }),
  ).toHaveText("Old wording.");
  await dialog
    .getByLabel("Review preview", { exact: true })
    .selectOption("final");
  await expect(
    dialog.getByLabel("final document preview", { exact: true }),
  ).toHaveText("New wording.");
  await dialog
    .getByLabel("Review author filter", { exact: true })
    .selectOption("Editor");
  await dialog.getByRole("button", { name: "Accept", exact: true }).click();
  await close();
  await expect(editor.locator("[data-revision-insertion]")).toHaveAttribute(
    "data-revision-insertion",
    insertionId,
  );
  await expect(editor.locator("strong")).toHaveText("New");
  await editor.press("Control+z");
  await expect(editor.locator("[data-revision-format]")).toHaveCount(1);
  await editor.press("Control+y");
  await expect(editor.locator("[data-revision-format]")).toHaveCount(0);
  report.checks.push(
    "Original/final previews preserve edits; accepting another author's formatting is separately undoable.",
  );
  stage("save and reopen");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Tracked manuscript" })
    .click();
  await expect(editor.locator("[data-revision-deletion]")).toHaveText("Old");
  await open();
  await expect(
    dialog.getByLabel("Track changes", { exact: true }),
  ).toBeChecked();
  await expect(dialog.getByLabel("Review author", { exact: true })).toHaveValue(
    "Editor",
  );
  await page.screenshot({ path: path.join(directory, "review.png") });
  await dialog.getByLabel("Review scope", { exact: true }).selectOption("all");
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await close();
  await expect(editor).toHaveText("Old wording.");
  report.checks.push(
    "Reopening retains review identities, author and tracking; rejecting the wording restores the original text.",
  );
  stage("paragraph formatting review");
  await select("p", 2, 2);
  await page.getByRole("button", { name: "Align centre", exact: true }).click();
  await expect(editor.locator("p[data-revision-paragraph]")).toHaveCount(1);
  await expect(editor.locator("p")).toHaveCSS("text-align", "center");
  await open();
  await dialog
    .getByLabel("Review preview", { exact: true })
    .selectOption("original");
  await expect(
    dialog
      .getByLabel("original document preview", { exact: true })
      .locator("p"),
  ).not.toHaveCSS("text-align", "center");
  await close();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Tracked manuscript" })
    .click();
  await expect(editor.locator("p[data-revision-paragraph]")).toHaveCount(1);
  await open();
  await dialog.getByLabel("Review scope", { exact: true }).selectOption("all");
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await close();
  await expect(editor.locator("p")).not.toHaveCSS("text-align", "center");
  await editor.press("Control+z");
  await expect(editor.locator("p[data-revision-paragraph]")).toHaveCount(1);
  await editor.press("Control+y");
  await expect(editor.locator("p[data-revision-paragraph]")).toHaveCount(0);
  report.checks.push(
    "Paragraph formatting retains the original preview through save/reopen, rejection and separate undo/redo.",
  );
  stage("paragraph and unsupported structure");
  await select("p", 4, 4);
  await editor.press("Enter");
  await expect(editor.locator("[data-revision-break]")).toHaveCount(1);
  await open();
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await close();
  await expect(editor.locator("p")).toHaveCount(1);
  await page.getByRole("button", { name: "Bullet list", exact: true }).click();
  await expect(
    page.getByText(/structural edit needs tracked structure support/),
  ).toBeVisible();
  await expect(editor.locator("ul")).toHaveCount(0);
  report.checks.push(
    "Paragraph split/rejection restores structure; unsupported tracking operations leave content intact.",
  );
  stage("multiline replacement and raw");
  await select("p", 0, 3);
  await editor.evaluate((el) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "New\nSecond");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor.locator("[data-revision-break]")).toHaveCount(1);
  await open();
  await dialog
    .getByLabel("Review preview", { exact: true })
    .selectOption("original");
  await expect(
    dialog.getByLabel("original document preview", { exact: true }),
  ).toHaveText("Old wording.");
  await close();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  const raw = page.getByRole("textbox", { name: /raw/i });
  await expect(raw).toBeVisible();
  const source = await raw.evaluate((el) =>
    [...el.querySelectorAll("p")].map((p) => p.textContent).join("\n"),
  );
  await raw.fill(source.replace("Second", "Revised"));
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(editor.locator("[data-revision-insertion]").last()).toHaveText(
    "Revised",
  );
  await open();
  await dialog.getByLabel("Review scope", { exact: true }).selectOption("all");
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await close();
  await expect(editor).toHaveText("Old wording.");
  report.checks.push(
    "Multiline paste and Raw edits retain recoverable paragraph and text revisions.",
  );
  stage("select all replacement");
  await editor.press("Control+a");
  await editor.pressSequentially("Replacement", { delay: 10 });
  await open();
  await dialog.getByLabel("Review scope", { exact: true }).selectOption("all");
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await close();
  await expect(editor).toHaveText("Old wording.");
  report.checks.push(
    "Select All replacement is tracked and restores the prior document on rejection.",
  );
  stage("independent copied changes");
  await open();
  await dialog.getByLabel("Track changes", { exact: true }).uncheck();
  await close();
  await editor.fill("");
  await editor.evaluate((el, html) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", html);
    clipboard.setData("text/plain", "New wording.");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, copiedHTML);
  await expect(editor.locator("[data-revision-insertion]")).toHaveText("New");
  expect(
    await editor
      .locator("[data-revision-insertion]")
      .getAttribute("data-revision-insertion"),
  ).not.toBe(insertionId);
  await editor.press("Control+End");
  await editor.pressSequentially("!", { delay: 10 });
  await expect(editor).toHaveText("OldNew wording.!");
  await expect(editor.locator("[data-revision-insertion]")).toHaveText("New");
  await editor.press("Control+z");
  await expect(editor).toHaveText("OldNew wording.");
  report.checks.push(
    "Ordinary edits with tracking off preserve pending changes and have separate undo.",
  );
  await open();
  await dialog.getByLabel("Review scope", { exact: true }).selectOption("all");
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await close();
  await expect(editor).toHaveText("Old wording.");
  report.checks.push(
    "Copied revisions get independent identities and retain their original wording for rejection.",
  );
  expect(errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close().catch(() => {});
}
