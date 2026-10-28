import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-pattern-"));
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
  await editor.fill("Code A12 and B34.");
  await editor.press("ControlOrMeta+f");
  const panel = page.getByRole("complementary", { name: "Find and replace" });
  await panel.locator("summary").click();
  await panel.getByLabel("Regular expression", { exact: true }).check();
  await panel.getByLabel("Find text", { exact: true }).fill("([A-Z])(\\d+)");
  await panel.getByLabel("Replacement text", { exact: true }).fill("$2/$1");
  await expect(panel.getByRole("status")).toHaveText("2 matches");
  await expect(panel.getByLabel("Replacement preview")).toContainText("12/A");
  await panel.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(editor).toHaveText("Code 12/A and 34/B.");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveText("Code A12 and B34.");
  checks.push(
    "worker search, capture expansion, replacement preview and one-step undo",
  );
  await panel.getByLabel("Find text", { exact: true }).fill("[");
  await expect(panel.getByRole("alert")).toContainText("Invalid pattern");
  await expect(
    panel.getByRole("button", { name: "Replace all", exact: true }),
  ).toBeDisabled();
  await panel.getByLabel("Find text", { exact: true }).fill("^");
  await expect(panel.getByRole("alert")).toContainText("empty positions");
  checks.push("invalid and empty-position patterns cannot apply replacements");
  await editor.fill("a".repeat(3000) + "!");
  await panel.getByLabel("Find text", { exact: true }).fill("(a+)+$");
  await expect(panel.getByRole("status")).toHaveText("Searching…");
  const latency = await page.evaluate(async () => {
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return performance.now() - start;
  });
  expect(latency).toBeLessThan(600);
  await expect(panel.getByRole("alert")).toContainText("took too long");
  await panel.getByLabel("Find text", { exact: true }).fill("a+");
  await expect(panel.getByRole("status")).toHaveText("1 matches");
  checks.push(
    "pathological expression times out without blocking renderer; subsequent search succeeds",
  );
  await panel
    .getByRole("button", { name: "Close find and replace", exact: true })
    .click();
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "work/pattern-search-report.json",
    JSON.stringify(
      { status: "passed", checks, rendererTimerMs: latency, errors },
      null,
      2,
    ),
  );
} catch (error) {
  await page
    ?.screenshot({ path: "work/pattern-search-failure.png" })
    .catch(() => {});
  fs.writeFileSync(
    "work/pattern-search-report.json",
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
