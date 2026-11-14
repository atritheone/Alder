// Only startup races, normal saving, and the native Mac reopen path.
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopExecutable } from "../desktop-paths.mjs";

const output = fs.mkdtempSync(path.join(os.tmpdir(), "alder-startup-lifecycle-"));
const results = [];
async function launch(name) {
  const profile = path.join(output, name);
  const env = { ...process.env, ALDER_DATA_DIR: path.join(profile, "data") };
  for (const key of ["PYTHONHOME", "PYTHONPATH", "ELECTRON_RUN_AS_NODE"]) delete env[key];
  const app = await electron.launch({ executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${path.join(profile, "chromium")}`], env, timeout: 60000 });
  await app.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.holdStartupHealth = true;
    globalThis.heldStartupRequests = 0;
    globalThis.fetch = async (...args) => {
      if (String(args[0]).endsWith("/api/health")) {
        globalThis.heldStartupRequests++;
        while (globalThis.holdStartupHealth) {
          args[1]?.signal?.throwIfAborted();
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      return original(...args);
    };
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  await page.locator(".start-screen").waitFor();
  await expect.poll(() => app.evaluate(() => globalThis.heldStartupRequests)).toBeGreaterThan(0);
  return { app, page };
}
let app;
try {
  ({ app } = await launch("early-close"));
  const started = performance.now();
  await app.close(); app = null;
  expect(performance.now() - started).toBeLessThan(6000);
  results.push("Normal close while core readiness is pending");

  let page;
  ({ app, page } = await launch("immediate-new"));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await app.evaluate(() => { globalThis.holdStartupHealth = false; });
  const editor = page.getByRole("textbox", { name: "TXT text editor", exact: true });
  await expect(editor).toBeVisible();
  await editor.fill("A document created before core readiness retains its edits.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  results.push("Immediate New queues safely until the core is ready");

  if (process.platform === "darwin") {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
    const reopened = app.waitForEvent("window");
    await app.evaluate(({ app }) => app.emit("activate"));
    page = await reopened;
    await expect(page.getByRole("textbox", { name: "TXT text editor", exact: true }))
      .toContainText("A document created before core readiness retains its edits.");
    await page.evaluate(() => window.alder.ready());
    results.push("Mac window close, backend shutdown, activation, and saved-session restore");
  }
  console.log(JSON.stringify({ status: "passed", platform: process.platform, checks: results }));
} finally { await app?.close(); }
