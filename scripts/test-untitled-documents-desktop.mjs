import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-untitled-"));
const first = path.join(data, "First.txt"),
  second = path.join(data, "Second.txt");
fs.writeFileSync(first, "First file content.");
fs.writeFileSync(second, "Second file content.");
const report = "work/untitled-documents-report.json";
let app;
const checks = [];
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
  const tabs = page.getByRole("tablist", { name: "Open documents" });
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const open = (files) =>
    page.locator('input[aria-label="Open documents"]').setInputFiles(files);
  async function create(kind, name) {
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("button", { name: kind, exact: false }).click();
    if (name)
      await page
        .getByRole("dialog", { name: "New document" })
        .getByLabel("Name", { exact: true })
        .fill(name);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await editor.waitFor();
  }
  async function closeAll() {
    while (await editor.isVisible()) {
      const count = await tabs.getByRole("tab").count();
      await page.keyboard.press("ControlOrMeta+w");
      if (count > 1)
        await expect(tabs.getByRole("tab")).toHaveCount(
          count === 2 ? 0 : count - 1,
        );
      else await expect(page.locator(".start-screen")).toBeVisible();
    }
  }
  for (const kind of ["Text document", "Word document", "Book"]) {
    await create(kind);
    await open(first);
    await expect(editor).toHaveText("First file content.");
    await expect(tabs).toHaveCount(0);
    checks.push(`${kind}: untouched Untitled replaced`);
    await closeAll();
  }
  await create("Text document");
  await open([first, second]);
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(
    tabs.getByRole("tab", { name: "Untitled", exact: true }),
  ).toHaveCount(0);
  checks.push("multi-open replaces only the empty starter");
  await closeAll();
  await create("Text document");
  await editor.fill("Keep my writing.");
  await open(first);
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await tabs.getByRole("tab", { name: "Untitled", exact: true }).click();
  await expect(editor).toHaveText("Keep my writing.");
  checks.push("edited Untitled retained");
  await closeAll();
  await create("Text document", "My project");
  await open(first);
  await expect(
    tabs.getByRole("tab", { name: "My project", exact: true }),
  ).toBeVisible();
  checks.push("named empty document retained");
  await closeAll();
  await create("Text document");
  const invalid = path.join(data, "Broken.alder");
  fs.writeFileSync(invalid, "not an archive");
  await open(invalid);
  await expect(
    page.getByRole("button", { name: "Dismiss error", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".project-label strong")).toHaveText("Untitled");
  await page
    .getByRole("button", { name: "Dismiss error", exact: true })
    .click();
  await open(first);
  await expect(editor).toHaveText("First file content.");
  await expect(tabs).toHaveCount(0);
  checks.push("failed open preserves starter until a successful open");
  await closeAll();
  await create("Text document");
  const saved = path.join(data, "Untitled.txt");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, saved);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => fs.existsSync(saved)).toBe(true);
  await open(first);
  await expect(
    tabs.getByRole("tab", { name: "Untitled", exact: true }),
  ).toBeVisible();
  checks.push("explicitly saved empty document retained");
  fs.writeFileSync(report, JSON.stringify({ status: "passed", checks }));
} catch (error) {
  fs.writeFileSync(
    report,
    JSON.stringify({ status: "failed", checks, error: error.stack }),
  );
  throw error;
} finally {
  await app?.close();
}
