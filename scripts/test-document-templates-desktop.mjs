import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-templates-"));
const report = { status: "running", checks: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("button", { name: "Word Document", exact: false })
    .click();
  await page
    .getByRole("dialog", { name: "New document", exact: true })
    .getByLabel("Name", { exact: true })
    .fill("Source manuscript");
  await expect(
    page.getByLabel("Document template", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await editor.fill(
    "Reusable letter opening.\nA second paragraph with room to write.",
  );
  await page
    .getByRole("button", { name: "Toggle Left Panel", exact: true })
    .click();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page
    .getByRole("button", { name: "Save document as template", exact: true })
    .click();
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Letter template");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.locator(".document-templates article")).toHaveCount(1);
  const saved = () =>
    page.evaluate(() =>
      window.alder.request(
        "GET",
        `/api/projects/${localStorage.getItem("alder.project")}`,
      ),
    );
  const original = await saved();
  await page
    .getByRole("button", { name: "Save document as template", exact: true })
    .click();
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Letter formatting");
  await page
    .getByLabel("Template contents", { exact: true })
    .selectOption("formatting");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.locator(".document-templates article")).toHaveCount(2);
  await page.screenshot({ path: "work/document-templates.png" });
  await page
    .getByRole("button", {
      name: "Remove template Letter template",
      exact: true,
    })
    .click();
  await expect(page.locator(".document-templates article")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo removal", exact: true }).click();
  await expect(page.locator(".document-templates article")).toHaveCount(2);
  const create = async (template, name) => {
    await page
      .getByRole("button", { name: "New from template…", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "New document",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Word Document", exact: false })
      .click();
    await dialog
      .getByLabel("Document template", { exact: true })
      .selectOption({ label: template });
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  };
  await create("Letter template", "Untitled");
  await expect(editor).toContainText("Reusable letter opening.");
  const first = await saved();
  expect(first.id).not.toBe(original.id);
  expect(first.book.chapters[0].document.content[0].attrs.blockId).not.toBe(
    original.book.chapters[0].document.content[0].attrs.blockId,
  );
  if (
    await page
      .getByRole("button", { name: "Toggle Left Panel", exact: true })
      .isVisible()
  )
    await page
      .getByRole("button", { name: "Toggle Left Panel", exact: true })
      .click();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await create("Letter formatting", "Blank letter");
  await expect(editor).toHaveText("");
  const blank = await saved();
  expect(
    blank.styles.map(({ id, basedOn, nextStyle, ...style }) => style),
  ).toEqual(
    original.styles.map(({ id, basedOn, nextStyle, ...style }) => style),
  );
  await expect(
    page.getByRole("tablist", { name: "Open documents" }).getByRole("tab"),
  ).toHaveCount(3);
  await page.getByRole("tab", { name: "Untitled", exact: true }).click();
  await editor.fill("Only this letter changes.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  report.checks.push(
    "create collected and formatting-only templates; remove and undo removal; new copies retain content/styles with independent identities",
  );
  await page.reload();
  await page.getByRole("button", { name: "New", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "New document",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Word Document", exact: false })
    .click();
  await dialog
    .getByLabel("Document template", { exact: true })
    .selectOption({ label: "Letter template" });
  await dialog.getByLabel("Name", { exact: true }).fill("After reopen");
  await page.screenshot({ path: "work/new-from-template.png" });
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(editor).toContainText("Reusable letter opening.");
  expect(
    (
      await page.evaluate(
        (id) => window.alder.request("GET", `/api/projects/${id}`),
        original.id,
      )
    ).book.chapters[0].document,
  ).toEqual(original.book.chapters[0].document);
  report.checks.push(
    "templates survive reopening; new content remains independent of previous copies and original source",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  await page
    ?.screenshot({ path: "work/document-templates-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    "work/document-templates-report.json",
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
