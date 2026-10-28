import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-format-image-"));
const report = "work/format-image-report.json";
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
  await page
    .getByRole("button", { name: "Word Document", exact: false })
    .click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const toolbar = page.locator(".book-main .format-toolbar");
  await editor.fill("Source wording");
  await editor.press("ControlOrMeta+a");
  await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
  const size = toolbar.getByRole("textbox", { name: "Font size", exact: true });
  await size.fill("17");
  await size.press("Enter");
  await toolbar.getByRole("button", { name: "More formatting" }).click();
  await page
    .getByRole("menuitem", { name: "Copy formatting", exact: true })
    .click();
  const other = path.join(data, "Target.txt");
  fs.writeFileSync(other, "Target wording");
  await page.locator('input[aria-label="Open documents"]').setInputFiles(other);
  await expect(editor).toHaveText("Target wording");
  await editor.press("ControlOrMeta+a");
  const altGraphHandled = await editor.evaluate((element) => {
    const event = new KeyboardEvent("keydown", {
      key: "v",
      code: "KeyV",
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
      bubbles: true,
      cancelable: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(altGraphHandled).toBe(false);
  await expect(editor.locator("strong")).toHaveCount(0);
  await editor.press("ControlOrMeta+Alt+v");
  await expect(editor.locator("strong")).toHaveText("Target wording");
  await expect(editor.locator("span").first()).toHaveCSS(
    "font-size",
    "22.6667px",
  );
  await editor.press("ControlOrMeta+z");
  await expect(editor.locator("strong")).toHaveCount(0);
  await expect(editor).toHaveText("Target wording");
  checks.push(
    "formatting menu and shortcut transfer appearance across documents; wording retained; one undo",
  );
  await page.getByRole("tab", { name: "Untitled", exact: true }).click();
  await expect(editor).toHaveText("Source wording");
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await page
    .getByRole("button", { name: "Toggle sandbox", exact: true })
    .click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await sandbox.fill("Separate sandbox wording");
  const choosing = page.waitForEvent("filechooser");
  await toolbar
    .getByRole("button", { name: "Insert image", exact: true })
    .click();
  await (
    await choosing
  ).setFiles({
    name: "square.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const img = editor.locator("img");
  await expect(img).toHaveCount(1);
  await expect(sandbox).toHaveText("Separate sandbox wording");
  await expect(sandbox.locator("img")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Toggle sandbox", exact: true })
    .click();
  checks.push(
    "Write image action targets Write even when Sandbox previously had focus",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  // Insertion leaves an image selection; use the accessible menu rather than
  // attempting to point at the one-pixel fixture before it has been resized.
  await expect
    .poll(() =>
      img.evaluate((element) => element.complete && element.naturalWidth),
    )
    .toBe(1);
  await toolbar.getByRole("button", { name: "More formatting" }).click();
  await page
    .getByRole("menuitem", { name: "Image properties…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Image properties",
    exact: true,
  });
  await dialog.getByLabel("Image width (mm)").fill("50.8");
  await dialog.getByLabel("Image alignment").selectOption("right");
  await dialog
    .getByLabel("Image alternative text")
    .fill("A square illustration");
  await dialog.getByLabel("Image title", { exact: true }).fill("Square title");
  await page.screenshot({ path: "work/image-properties-dialog.png" });
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(img).toHaveAttribute("width", "192");
  await expect(img).toHaveAttribute("alt", "A square illustration");
  await expect(img).toHaveAttribute("title", "Square title");
  await expect(editor.locator("figure")).toHaveCSS("text-align", "right");
  await editor.press("ControlOrMeta+z");
  await expect(img).not.toHaveAttribute("width");
  await editor.press("ControlOrMeta+Shift+z");
  await expect(img).toHaveAttribute("width", "192");
  await img.dblclick();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Image width (mm)")).toHaveValue("50.8");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const originalAsset = await img.getAttribute("data-asset-id");
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(img).not.toHaveAttribute("data-asset-id", originalAsset);
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute("width", "192");
  await expect(img).toHaveAttribute("alt", "A square illustration");
  await img.dblclick();
  await dialog.getByLabel("Image asset").selectOption(originalAsset);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(img).toHaveAttribute("data-asset-id", originalAsset);
  checks.push(
    "replacing a selected image preserves its size and descriptions; collected image chooser can restore the prior asset",
  );
  checks.push(
    "image properties via menu and double-click; width/proportions, alignment and descriptions; one undo/redo",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "Untitled", exact: false }).click();
  await expect(img).toHaveAttribute("width", "192");
  await expect(img).toHaveAttribute("alt", "A square illustration");
  await expect(editor.locator("figure")).toHaveCSS("text-align", "right");
  checks.push("image properties persist after reopening");
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
  await page
    ?.screenshot({ path: "work/format-image-failure.png" })
    .catch(() => {});
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
