import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-tables-"));
const checks = [];
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 1000);
    win.show();
    win.focus();
  });
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("button", { name: "Word Document", exact: false })
    .click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const menu = async (label) => {
    await page
      .locator(".book-main .format-toolbar")
      .getByRole("button", { name: "More formatting" })
      .click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  };
  const pasteHTML = async (html) =>
    editor.evaluate((element, html) => {
      const data = new DataTransfer();
      data.setData("text/html", html);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    }, html);
  await editor.click();
  await pasteHTML(
    "<table><tbody><tr><th><p>Item</p></th><th><p>Value</p></th></tr><tr><td><p>Item 10</p></td><td><p>2</p></td></tr><tr><td><p>Item 2</p></td><td><p>1</p></td></tr></tbody></table>",
  );
  const table = editor.locator("table");
  const target = table.locator("tr").nth(1).locator("td").first();
  await target.click();
  await menu("Table properties…");
  const dialog = page.getByRole("dialog", {
    name: "Table properties",
    exact: true,
  });
  await dialog
    .getByLabel("Table alignment", { exact: true })
    .selectOption("right");
  await dialog
    .getByLabel("Cell vertical alignment", { exact: true })
    .selectOption("bottom");
  await dialog.getByLabel("Top padding (pt)", { exact: true }).fill("12");
  await dialog.getByLabel("Border width (pt)", { exact: true }).fill("2");
  await dialog.getByLabel("Border colour", { exact: true }).fill("#123456");
  await dialog.getByLabel("Shading", { exact: true }).fill("#ddeeff");
  await dialog
    .getByLabel("Minimum row height (pt)", { exact: true })
    .fill("48");
  await dialog.getByLabel("Column width (mm)", { exact: true }).fill("30");
  await page.screenshot({ path: "work/table-properties-dialog.png" });
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(target).toHaveCSS("padding-top", "16px");
  await expect(target).toHaveCSS("border-top-color", "rgb(18, 52, 86)");
  await expect(target).toHaveCSS("background-color", "rgb(221, 238, 255)");
  await expect(target).toHaveCSS("vertical-align", "bottom");
  await expect(table).toHaveAttribute("data-table-align", "right");
  await editor.press("ControlOrMeta+z");
  await expect(target).not.toHaveCSS("background-color", "rgb(221, 238, 255)");
  await editor.press("ControlOrMeta+Shift+z");
  await expect(target).toHaveCSS("padding-top", "16px");
  checks.push(
    "property dialog, actual rendered cell styles, one undo and redo",
  );
  await target.click();
  await menu("Table properties…");
  await dialog.getByLabel("Column width (mm)", { exact: true }).fill("6.62");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  expect(await target.evaluate(cell => cell.offsetWidth)).toBeLessThanOrEqual(27);
  await editor.press("ControlOrMeta+z");
  await target.click();
  await menu("Sort by this column, ascending");
  await expect(table.locator("tr").nth(1)).toContainText("Item 2");
  await expect(table.locator("tr").nth(2).locator("td").first()).toHaveCSS(
    "padding-top",
    "16px",
  );
  await expect(table.locator("tr").first()).toContainText("ItemValue");
  checks.push(
    "natural sorting retains heading row and moves cell properties with their content",
  );
  // Exercise actual browser serializer-compatible clipboard properties without OS clipboard access.
  const html = await table.evaluate((node) => node.outerHTML);
  await editor.press("ControlOrMeta+a");
  await pasteHTML(html);
  await expect(table).toHaveCount(1);
  await expect(table.locator("tr").nth(2).locator("td").first()).toHaveCSS(
    "border-top-color",
    "rgb(18, 52, 86)",
  );
  await expect(table).toHaveAttribute("data-table-align", "right");
  checks.push(
    "browser clipboard round trip retains table alignment and cell appearance",
  );
  await table.locator("td").first().click();
  await menu("Convert table to text");
  await expect(table).toHaveCount(0);
  await editor.press("ControlOrMeta+a");
  await menu("Convert tab-separated text to table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(table.locator("tr").nth(1)).toContainText("Item 2");
  checks.push(
    "table/text conversion preserves text order and rectangular columns",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "Untitled", exact: false }).click();
  await expect(table.locator("tr")).toHaveCount(3);
  checks.push("converted table persists after reopening");
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "work/table-properties-report.json",
    JSON.stringify({ status: "passed", checks, errors }, null, 2),
  );
} catch (error) {
  await page
    ?.screenshot({ path: "work/table-properties-failure.png" })
    .catch(() => {});
  fs.writeFileSync(
    "work/table-properties-report.json",
    JSON.stringify(
      {
        status: "failed",
        checks,
        error: error.stack,
        content: await page
          ?.locator("body")
          .innerText()
          .catch(() => "Unavailable"),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close();
}
