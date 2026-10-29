import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-history-"));
const report = { status: "running", checks: [] };
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
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  const native = async (label) =>
    app.evaluate(({ Menu, BrowserWindow }, label) => {
      const item = Menu.getApplicationMenu()
        .items.flatMap((m) => m.submenu?.items || [])
        .find((i) => i.label === label);
      if (!item) throw Error("Missing command " + label);
      const w = BrowserWindow.getAllWindows()[0];
      Reflect.apply(item.click, item, [
        { triggeredByAccelerator: false },
        w,
        w.webContents,
      ]);
    }, label);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Book", exact: false }).click();
  await page.getByLabel("Name", { exact: true }).fill("History manuscript");
  await page.getByLabel("Chapters", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const chapter = (n) =>
    page
      .getByRole("button", { name: `Open chapter Chapter ${n}`, exact: true })
      .click();
  const saved = () => expect(page.locator(".save-status")).toHaveText("Saved");
  const project = () =>
    page.evaluate(() =>
      window.alder.request(
        "GET",
        "/api/projects/" + localStorage.getItem("alder.project"),
      ),
    );
  await editor.fill("One");
  await chapter(2);
  await editor.fill("Two");
  await chapter(1);
  await editor.press("Control+End");
  await page.keyboard.type(" edited");
  await page.getByLabel("Include in book", { exact: true }).uncheck();
  await chapter(2);
  await editor.press("Control+End");
  await page.keyboard.type(" changed");
  await saved();
  await editor.press("Control+z");
  await expect(editor).toHaveText("Two");
  await expect(editor).toBeFocused();
  await editor.press("Control+z");
  await saved();
  expect((await project()).book.chapters[0].include).toBe(true);
  await editor.press("Control+z");
  await expect(editor).toHaveText("One");
  await expect(editor).toBeFocused();
  await editor.press("Control+y");
  await expect(editor).toHaveText("One edited");
  await editor.press("Control+y");
  await expect(
    page.getByLabel("Include in book", { exact: true }),
  ).not.toBeChecked();
  await editor.press("Control+y");
  await expect(editor).toHaveText("Two changed");
  report.checks.push(
    "typing and structural changes undo and redo chronologically across chapters",
  );
  await saved();
  await page.keyboard.press("Control+n");
  await page
    .getByRole("button", { name: "Word Document", exact: false })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Second manuscript");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "New document", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Second manuscript", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await editor.fill("Other document");
  await page
    .getByRole("tab", { name: "History manuscript", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "History manuscript", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(editor).toHaveText("Two changed");
  await editor.press("Control+z");
  await expect(editor).toHaveText("Two");
  await page
    .getByRole("tab", { name: "Second manuscript", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Second manuscript", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(editor).toHaveText("Other document");
  await editor.press("Control+z");
  await expect(editor).toHaveText("");
  await page
    .getByRole("tab", { name: "History manuscript", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "History manuscript", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(editor).toHaveText("Two");
  report.checks.push(
    "independent histories survive autosave and document switches",
  );
  const toggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await expect(
    page.getByRole("button", { name: "New sandbox draft", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New sandbox draft", exact: true })
    .click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await sandbox.fill("Draft");
  await editor.press("Control+End");
  await page.keyboard.type(" A");
  await sandbox.press("Control+End");
  await page.keyboard.type(" B");
  await editor.press("Control+z");
  await expect(sandbox).toHaveText("Draft");
  await expect(sandbox).toBeFocused();
  await sandbox.press("Control+z");
  await expect(editor).toHaveText("Two");
  await expect(editor).toBeFocused();
  await editor.press("Control+y");
  await expect(editor).toHaveText("Two A");
  await editor.press("Control+y");
  await expect(sandbox).toHaveText("Draft B");
  await expect(sandbox).toBeFocused();
  await saved();
  report.checks.push(
    "Write and Sandbox share ordering and restore originating editor focus",
  );

  await saved();
  await page.keyboard.press("Control+n");
  await expect(
    page.getByRole("dialog", { name: "New document", exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const id = localStorage.getItem("alder.project");
    const p = await window.alder.request("GET", "/api/projects/" + id);
    p.name += " External";
    await window.alder.request("PUT", "/api/projects/" + id, {
      expectedRevision: p.revision,
      project: p,
    });
  });
  // Inject a queued editor edit after New opens, then make its save conflict.
  await editor.evaluate((el) => {
    el.focus();
    document.execCommand("insertText", false, " Unsaved");
  });
  await page.getByLabel("Name", { exact: true }).fill("Failed handoff");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "New document", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        document.querySelector("[role=tab][aria-selected=true]")?.textContent,
    ),
  ).not.toContain("Failed handoff");
  await expect(editor).toContainText("Unsaved");
  report.checks.push(
    "failed save preserves the current document and keeps New open",
  );
  expect(errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  report.text = await page
    ?.locator("body")
    .innerText()
    .catch(() => null);
  await page
    ?.screenshot({ path: "work/project-history-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    "work/project-history-report.json",
    JSON.stringify(report, null, 2),
  );
  // This fixture intentionally leaves a save conflict; close only its owned test process.
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
