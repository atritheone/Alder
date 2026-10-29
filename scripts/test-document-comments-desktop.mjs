import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-comments-")),
  directory = path.resolve("work/document-comments");
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
  await page.getByLabel("Name", { exact: true }).fill("Review manuscript");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Comments", exact: true });
  const open = async () => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Comments…", exact: true })
      .click();
  };
  const choose = () => dialog.getByRole("listitem").first().click();
  stage("insertion and undo");
  await editor.fill("First selected passage. Following text.");
  await editor.evaluate(async (el) => {
    const node = el.querySelector("p").firstChild;
    getSelection().setBaseAndExtent(node, 6, node, 22);
    await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => getSelection().toString())).toBe(
    "selected passage",
  );
  await editor.press("Control+Alt+m");
  await dialog.getByLabel("Comment author").fill("Reviewer");
  await dialog.getByLabel("Comment text").fill("Check this wording.");
  await dialog
    .getByRole("button", { name: "Add comment", exact: true })
    .click();
  await expect(editor).toBeFocused();
  await expect(editor.locator("[data-comment-thread]")).toHaveCount(2);
  await expect(editor.locator(".document-comment-passage")).toHaveText(
    "selected passage",
  );
  await editor.press("Control+z");
  await expect(editor.locator("[data-comment-thread]")).toHaveCount(0);
  await editor.press("Control+y");
  await expect(editor.locator("[data-comment-thread]")).toHaveCount(2);
  report.checks.push(
    "A selected passage gains a silent annotation; one undo/redo restores both anchors.",
  );
  stage("reply and resolve");
  await open();
  await choose();
  await dialog.getByLabel("Comment text").fill("Agreed.");
  await dialog.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(
    dialog.getByRole("region", { name: "Selected comment" }).locator("article"),
  ).toHaveCount(2);
  await dialog.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Show resolved").uncheck();
  await expect(dialog.getByRole("listitem")).toHaveCount(0);
  await dialog.getByLabel("Show resolved").check();
  await dialog.getByRole("button", { name: "Reopen", exact: true }).click();
  await page.screenshot({ path: path.join(directory, "comments.png") });
  await dialog
    .getByRole("button", { name: "Go to passage", exact: true })
    .click();
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => getSelection().toString())).toBe(
    "selected passage",
  );
  report.checks.push(
    "Replies, resolve/reopen, filtering and passage navigation retain focus and selected wording.",
  );
  stage("copy and raw");
  const original = await editor
    .locator("[data-comment-thread]")
    .first()
    .getAttribute("data-comment-thread");
  const html = await editor.innerHTML();
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", el.textContent);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, html);
  await expect(editor.locator("[data-comment-thread]")).toHaveCount(4);
  const ids = await editor
    .locator("[data-comment-thread]")
    .evaluateAll((els) => els.map((e) => e.dataset.commentThread));
  expect(ids[0]).toBe(original);
  expect(ids[0]).toBe(ids[1]);
  expect(ids[2]).toBe(ids[3]);
  expect(ids[0]).not.toBe(ids[2]);
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  const raw = page.getByRole("textbox", { name: /raw/i });
  await expect(raw).toBeVisible();
  const source = await raw.evaluate((el) =>
    [...el.querySelectorAll("p")].map((p) => p.textContent).join("\n"),
  );
  await raw.fill(source.replace("Following text.", "Updated text."));
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(editor.locator("[data-comment-thread]")).toHaveCount(4);
  report.checks.push(
    "Clipboard copies get independent thread identities; Raw editing retains review text and endpoints.",
  );
  stage("save and reopen");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Review manuscript" })
    .click();
  const reopened = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(reopened.locator("[data-comment-thread]")).toHaveCount(4);
  const payload = await reopened
    .locator("[data-comment-thread]")
    .first()
    .getAttribute("data-comment-content");
  expect(JSON.parse(payload).entries.map((e) => e.text)).toEqual([
    "Check this wording.",
    "Agreed.",
  ]);
  stage("outline and export review");
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()
      .items.find((i) => i.label === "View")
      .submenu.items.find((i) => /^show outline$/i.test(i.label));
    item.click(item, BrowserWindow.getAllWindows()[0]);
  });
  const outline = page.getByRole("complementary", { name: "Document outline" });
  await outline.getByLabel("Outline contents").selectOption("comments");
  await outline.getByLabel("Find comment").fill("Agreed");
  await expect(
    outline
      .getByRole("navigation", { name: "Document comments" })
      .getByRole("button"),
  ).toHaveCount(2);
  await outline
    .getByRole("navigation", { name: "Document comments" })
    .getByRole("button")
    .first()
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Comments", exact: true })
      .getByRole("region", { name: "Selected comment" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Comments", exact: true })
    .press("Escape");
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()
      .items.find((i) => i.label === "File")
      .submenu.items.find((i) => i.label === "Export…");
    item.click(item, BrowserWindow.getAllWindows()[0]);
  });
  await expect(
    page.getByText("2 unresolved comment threads in the included chapters."),
  ).toBeVisible();
  const include = page.getByLabel(
    "Include review comments in Word, HTML and EPUB",
  );
  await expect(include).toBeChecked();
  await include.uncheck();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  report.checks.push(
    "Outline searches replies and opens their thread; Export reports unresolved work and persists the clean-copy preference.",
  );
  expect(errors).toEqual([]);
  report.checks.push(
    "Saved/reopened threads keep their replies, identity and resolution state.",
  );
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
