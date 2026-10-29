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

  const fixture = await page.evaluate(async () => {
    const p = await window.alder.request("POST", "/api/projects", {
      name: "List continuation",
      template: "blank",
    });
    const para = (text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
    const list = (text, order) => ({
      type: "ordered_list",
      attrs: { order },
      content: [{ type: "list_item", content: [para(text)] }],
    });
    p.settings.documentKind = "docx";
    p.book = {
      version: 1,
      chapters: [
        {
          id: "lists",
          title: "Document",
          include: true,
          document: {
            type: "doc",
            content: [list("First", 4), para("Between"), list("Second", 1)],
          },
        },
      ],
    };
    await window.alder.request("PUT", "/api/projects/" + p.id, {
      expectedRevision: p.revision,
      project: p,
    });
    localStorage.setItem("alder.project", p.id);
    return p.id;
  });
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "List continuation" })
    .click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor.locator("ol")).toHaveCount(2);
  await editor
    .locator("p")
    .filter({ hasText: "Second" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "List…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "List", exact: true });
  await dialog
    .getByLabel("List numbering", { exact: true })
    .selectOption("continue");
  await expect(dialog.getByLabel("List start", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor.locator("ol").nth(1)).toHaveAttribute("start", "5");
  await expect(editor).toBeFocused();
  await editor.press("Control+z");
  await expect(editor.locator("ol").nth(1)).toHaveAttribute("start", "1");
  await editor.press("Control+y");
  await expect(editor.locator("ol").nth(1)).toHaveAttribute("start", "5");
  await editor
    .locator("p")
    .filter({ hasText: "First" })
    .click({ position: { x: 15, y: 10 } });
  report.afterClick = await page.evaluate(() => ({
    text: getSelection()?.anchorNode?.textContent,
    offset: getSelection()?.anchorOffset,
  }));
  await editor.press("End");
  report.afterEnd = await page.evaluate(() => ({
    text: getSelection()?.anchorNode?.textContent,
    offset: getSelection()?.anchorOffset,
  }));
  await editor.press("Enter");
  await page.keyboard.type("Added");
  await expect(editor.locator("ol").nth(1)).toHaveAttribute("start", "6");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "List continuation" })
    .click();
  await expect(editor.locator("ol").nth(1)).toHaveAttribute("start", "6");
  await expect(editor.locator("ol").nth(1)).toHaveAttribute(
    "data-continue-list",
    "true",
  );
  await editor
    .locator("p")
    .filter({ hasText: "Second" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "List…", exact: true }).click();
  await dialog
    .getByLabel("List numbering", { exact: true })
    .selectOption("restart");
  await dialog.getByLabel("List start", { exact: true }).fill("9");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor.locator("ol").nth(1)).toHaveAttribute("start", "9");
  report.checks.push(
    "continue/restart controls, atomic undo/redo, renumber on insert, autosave and reopen",
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
    ?.screenshot({ path: "work/list-continuation-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    "work/list-continuation-report.json",
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
