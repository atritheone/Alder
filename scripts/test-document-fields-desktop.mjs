import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-fields-")),
  directory = path.resolve("work/document-fields");
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
  await page.getByLabel("Name", { exact: true }).fill("Field manuscript");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  const menu = async (name) => {
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  };
  const settings = async (author) => {
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()
        .items.find((i) => i.label === "Edit")
        .submenu.items.find((i) => i.label === "Settings…");
      item.click(item, BrowserWindow.getAllWindows()[0]);
    });
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    await dialog.getByRole("tab", { name: "Publication", exact: true }).click();
    await dialog.getByLabel("Author", { exact: true }).fill(author);
    await dialog.press("Escape");
    await expect(dialog).toHaveCount(0);
  };
  const fieldDialog = page.getByRole("dialog", {
    name: "Insert field",
    exact: true,
  });
  stage("insertion");
  await editor.fill("By ");
  await editor.press("Control+End");
  await menu("Insert field…");
  await fieldDialog.getByLabel("Field", { exact: true }).selectOption("author");
  await expect(
    fieldDialog.getByRole("button", { name: "Insert", exact: true }),
  ).toBeDisabled();
  await fieldDialog.press("Escape");
  await expect(editor).toBeFocused();
  await settings("A. Writer");
  await editor.press("Control+End");
  await menu("Insert field…");
  await fieldDialog.getByLabel("Field", { exact: true }).selectOption("author");
  await fieldDialog
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await expect(editor).toBeFocused();
  await expect(editor.locator("[data-document-field=author]")).toHaveText(
    "A. Writer",
  );
  await page.keyboard.type(" today");
  await editor.press("Control+z");
  await expect(editor).toHaveText("By A. Writer");
  await editor.press("Control+z");
  await expect(editor).toHaveText("By ");
  await editor.press("Control+y");
  await expect(editor.locator("[data-document-field=author]")).toHaveText(
    "A. Writer",
  );
  report.checks.push(
    "Missing properties cannot insert; insertion returns focus and has its own undo event.",
  );
  stage("refresh and caret");
  await settings("Changed Author");
  await editor.press("Control+End");
  report.selectionBeforeTyping = await page.evaluate(() => {
    const s = getSelection();
    return {
      node: s.anchorNode?.parentElement?.outerHTML,
      offset: s.anchorOffset,
      focus: document.activeElement?.getAttribute("aria-label"),
    };
  });
  await page.keyboard.type(" following");
  await expect(editor).toHaveText("By A. Writer following");
  report.beforeRefresh = await editor.innerHTML();
  await menu("Update fields");
  report.afterRefresh = await editor.innerHTML();
  await expect(editor.locator("[data-document-field=author]")).toHaveText(
    "Changed Author",
  );
  await page.keyboard.type(" tail");
  await expect(editor).toHaveText("By Changed Author following tail");
  await editor.press("Control+z");
  await editor.press("Control+z");
  await expect(editor.locator("[data-document-field=author]")).toHaveText(
    "A. Writer",
  );
  await editor.press("Control+y");
  await expect(editor.locator("[data-document-field=author]")).toHaveText(
    "Changed Author",
  );
  report.checks.push(
    "Field refresh follows changed settings, maps the caret and undoes separately from typing.",
  );
  stage("raw and reopen");
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  const raw = page.getByRole("textbox", {
    name: "Raw text editor",
    exact: true,
  });
  const html = await raw.innerText();
  await raw.fill(html.replace("By ", "Written by "));
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(editor.locator("[data-document-field=author]")).toHaveText(
    "Changed Author",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Field manuscript" })
    .click();
  await expect(editor.locator("[data-document-field=author]")).toHaveText(
    "Changed Author",
  );
  await editor.press("Control+End");
  await editor.press("Enter");
  await menu("Insert field…");
  await fieldDialog.getByLabel("Field", { exact: true }).selectOption("date");
  await expect(
    fieldDialog.getByLabel("Field preview", { exact: true }),
  ).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  await page.screenshot({ path: path.join(directory, "dialog.png") });
  await fieldDialog
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await expect(editor.locator("[data-document-field=date]")).toHaveText(
    /^\d{4}-\d{2}-\d{2}$/,
  );
  report.checks.push(
    "Raw edits and reopening retain the live field; the date preview and insertion use an explicit ISO date.",
  );
  stage("page fields and single undo");
  for (const kind of ["page", "pageCount"]) {
    await editor.press("Control+End");
    await page.keyboard.type(" ");
    await menu("Insert field…");
    await fieldDialog.getByLabel("Field", { exact: true }).selectOption(kind);
    await fieldDialog
      .getByRole("button", { name: "Insert", exact: true })
      .click();
    await expect(editor.locator(`[data-document-field="${kind}"]`)).toHaveText(
      "1",
      { timeout: 15000 },
    );
    await editor.press("Control+z");
    await expect(editor.locator(`[data-document-field="${kind}"]`)).toHaveCount(
      0,
    );
    await editor.press("Control+y");
    await expect(editor.locator(`[data-document-field="${kind}"]`)).toHaveText(
      "1",
    );
  }
  await editor.press("Control+Home");
  await menu("Insert page break");
  await menu("Update fields");
  await expect(editor.locator('[data-document-field="page"]')).toHaveText("2", {
    timeout: 15000,
  });
  await expect(editor.locator('[data-document-field="pageCount"]')).toHaveText(
    "2",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Field manuscript" })
    .click();
  await expect(editor.locator('[data-document-field="page"]')).toHaveText("2");
  await expect(editor.locator('[data-document-field="pageCount"]')).toHaveText(
    "2",
  );
  report.checks.push(
    "Page/total-page fields calculate before insertion, undo separately, update after a page break and persist.",
  );
  stage("shared PDF page fields");
  const pdf = await page.evaluate(async () => {
    const { projects } = await window.alder.request("GET", "/api/projects");
    const p = projects.find((p) => p.name === "Field manuscript");
    const result = await window.alder.request(
      "POST",
      `/api/projects/${p.id}/export`,
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
  });
  fs.writeFileSync(path.join(directory, "fields.pdf"), Buffer.from(pdf.bytes));
  expect(pdf.result.validation.status).toBe("passed");
  expect(pdf.result.validation.pages).toBe(2);
  report.checks.push(
    "Desktop PDF recalculates page fields from the same two-page publication.",
  );
  expect(errors).toEqual([]);
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
