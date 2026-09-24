import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-tabs-"));
const files = ["First", "Second", "Third"].map((name) => {
  const file = path.join(data, name + ".txt");
  fs.writeFileSync(
    file,
    Array.from(
      { length: 80 },
      (_, i) =>
        `${name} document paragraph ${i}. Keep this text in its own file.`,
    ).join("\n\n"),
  );
  return file;
});
const report = "work/document-tabs-report.json";
let app;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1280, 900);
    w.showInactive();
  });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".start-screen input[type=file]")
    .setInputFiles(files.slice(0, 2));
  const tabs = page.getByRole("tablist", { name: "Open documents" });
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(editor).toContainText("Second document");
  await page.screenshot({path: "work/document-tabs.png"});
  await page.keyboard.press("Control+Tab");
  await expect(editor).toContainText("First document");
  await page.keyboard.press("Control+Shift+Tab");
  await expect(editor).toContainText("Second document");

  await tabs.getByRole("tab", { name: "First", exact: true }).click();
  await expect(editor).toContainText("First document");
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await editor.pressSequentially("Saved across tabs.");
  await page.getByLabel("Page zoom", { exact: true }).selectOption("1.3");
  const scroll = page.locator(".book-editor .editor-scroll");
  await scroll.evaluate((el) => {
    el.scrollTop = 800;
  });
  await tabs.getByRole("tab", { name: "Second", exact: true }).click();
  await expect(editor).not.toContainText("Saved across tabs.");
  await tabs.getByRole("tab", { name: "First", exact: true }).click();
  await expect(editor).toContainText("Saved across tabs.");
  await expect(page.getByLabel("Page zoom", { exact: true })).toHaveValue(
    "1.3",
  );
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollTop))
    .toBeCloseTo(800, 0);
  await app.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.rejectTabSaves = true;
    globalThis.fetch = (...args) => {
      if (
        globalThis.rejectTabSaves &&
        args[1]?.method === "PUT" &&
        /\/api\/projects\/[^/]+$/.test(String(args[0]))
      )
        return Promise.resolve(
          Response.json({ detail: "Test save unavailable" }, { status: 503 }),
        );
      return original(...args);
    };
  });
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially(" Protected edits.");
  await tabs.getByRole("tab", { name: "Second", exact: true }).click();
  await expect(page.getByText(/Test save unavailable/)).toBeVisible();
  await expect(
    tabs.getByRole("tab", { name: "First", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("button", { name: "Close First", exact: true }).click();
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(editor).toContainText("Protected edits.");
  await app.evaluate(() => {
    globalThis.rejectTabSaves = false;
  });
  await tabs.evaluate((el) => {
    const buttons = el.querySelectorAll('[role="tab"]');
    buttons[1].click();
    buttons[0].click();
  });
  await expect(
    tabs.getByRole("tab", { name: "First", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(editor).toContainText("Protected edits.");
  // Opening an already-open file selects its edited document, without reimporting it.
  await page
    .locator('input[aria-label="Open documents"]')
    .setInputFiles(files[0]);
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(editor).toContainText("Saved across tabs.");
  await page
    .locator('input[aria-label="Open documents"]')
    .setInputFiles(files[2]);
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await expect(editor).toContainText("Third document");
  await page.getByRole("button", {name: "Dismiss error", exact: true}).click();
  await tabs.getByRole("button", { name: "Close Second", exact: true }).click();
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(editor).toContainText("Third document");
  await tabs.getByRole("button", { name: "Close Third", exact: true }).click();
  await expect(tabs).toHaveCount(0);
  await expect(editor).toContainText("Saved across tabs.");
  await page.keyboard.press("ControlOrMeta+w");
  await expect(page.locator(".start-screen")).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: "First", exact: true }).click();
  await expect(editor).toContainText("Saved across tabs.");
  fs.writeFileSync(
    report,
    JSON.stringify({
      status: "passed",
      checks:
        "multi-open; independent edits; scroll and zoom; deduplication; open additional file; close inactive/active/last; reopen saved edits; save failure protection; rapid switching",
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
