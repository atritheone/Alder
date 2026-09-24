import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-position-"));
const file = path.join(data, "position.txt");
fs.writeFileSync(
  file,
  Array.from(
    { length: 250 },
    (_, i) => `Paragraph ${i}. This is a long document to restore.`,
  ).join("\n\n"),
);
const report = "work/document-position-report.json";
let app;
async function launch() {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1280, 900);
    w.showInactive();
  });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator(".start-screen input[type=file]").setInputFiles(file);
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .waitFor();
  return page;
}
async function settings(page, category) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.send(
      "alder:command",
      "settings",
    ),
  );
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: category, exact: true }).click();
  return dialog;
}
try {
  let page = await launch();
  let dialog = await settings(page, "Writing");
  await expect(
    dialog.getByLabel("Remember document position", { exact: true }),
  ).toBeChecked();
  await dialog.getByRole("tab", { name: "Speech", exact: true }).click();
  await expect(
    dialog.getByLabel("Read hyperlinks", { exact: true }),
  ).not.toBeChecked();
  await dialog.getByLabel("Read hyperlinks", { exact: true }).check();
  await dialog.press("Escape");
  await page.getByLabel("Page zoom", { exact: true }).selectOption("1.3");
  const scroll = () => page.locator(".book-editor .editor-scroll");
  await expect
    .poll(() => scroll().evaluate((el) => el.scrollHeight))
    .toBeGreaterThan(2000);
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .evaluate((el) => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
  await scroll().evaluate((el) => {
    el.scrollTop = 1300;
  });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("alder-save-document-position")),
  );
  const stored = await page.evaluate(
    () =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith("alder.documentPosition."))
        .map((k) => JSON.parse(localStorage.getItem(k)))[0],
  );
  expect(stored.top).toBeCloseTo(1300, 0);
  expect(stored.offset).toBeGreaterThan(100);
  await app.close();
  page = await launch();
  await expect(page.getByLabel("Page zoom", { exact: true })).toHaveValue(
    "1.3",
  );
  await expect
    .poll(() => scroll().evaluate((el) => el.scrollTop))
    .toBeCloseTo(stored.top, 0);
  dialog = await settings(page, "Speech");
  await expect(
    dialog.getByLabel("Read hyperlinks", { exact: true }),
  ).toBeChecked();
  await dialog.getByRole("tab", { name: "Writing", exact: true }).click();
  await dialog
    .getByLabel("Remember document position", { exact: true })
    .uncheck();
  await dialog.press("Escape");
  await app.close();
  page = await launch();
  await expect(page.getByLabel("Page zoom", { exact: true })).toHaveValue(
    "0.8",
  );
  await expect.poll(() => scroll().evaluate((el) => el.scrollTop)).toBe(0);
  dialog = await settings(page, "Writing");
  await expect(
    dialog.getByLabel("Remember document position", { exact: true }),
  ).not.toBeChecked();
  fs.writeFileSync(
    report,
    JSON.stringify({
      status: "passed",
      stored,
      checks:
        "same-file reopening restores scroll and zoom; both preferences persist; disabling restores start",
    }),
  );
} catch (error) {
  fs.writeFileSync(
    report,
    JSON.stringify({ status: "failed", error: error.stack }),
  );
  throw error;
} finally {
  await app?.close();
}
