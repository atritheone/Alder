// TXT open/switch/close retention check, separate from rich-document qualification.
import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "alder-txt-memory-"));
const report = { status: "running", samples: [], errors: [] };
let app;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [
      ".",
      "--headless-test",
      `--user-data-dir=${path.join(profile, "profile")}`,
    ],
    env: {
      ...process.env,
      ALDER_DATA_DIR: path.join(profile, "data"),
      ALDER_RESOURCES_DIR: path.resolve("work/bundle-resources"),
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  const cdp = await page.context().newCDPSession(page),
    editor = page.getByRole("textbox", {
      name: "TXT text editor",
      exact: true,
    });
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(editor).toBeVisible();
    await page.evaluate((cycle) => {
      const input = document.querySelector(
          'input[aria-label="Open documents"]',
        ),
        transfer = new DataTransfer(),
        line =
          "Alder releases closed editor views and retains bounded reopen history.\n",
        text = line
          .repeat(Math.ceil(1024 ** 2 / line.length))
          .slice(0, 1024 ** 2);
      for (let i = 0; i < 2; i++)
        transfer.items.add(
          new File(
            [`Document ${cycle}-${i}.\n`, text],
            `TXT memory ${cycle}-${i}.txt`,
            { type: "text/plain" },
          ),
        );
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, cycle);
    const tabs = page.getByRole("tablist", { name: "Open documents" });
    await expect(tabs.getByRole("tab")).toHaveCount(2, { timeout: 30000 });
    for (let i = 0; i < 2; i++) {
      await tabs
        .getByRole("tab", { name: `TXT memory ${cycle}-${i}`, exact: true })
        .click();
      await editor.press("Control+Home");
      await editor.pressSequentially(`Edit ${i}. `);
      await expect(page.locator(".save-status")).toHaveText("Saved");
    }
    for (let i = 0; i < 2; i++) {
      await tabs
        .getByRole("tab", { name: `TXT memory ${cycle}-${i}`, exact: true })
        .click();
      await editor.press("Control+Home");
      await expect(editor.locator(".cm-line").first()).toContainText(
        `Edit ${i}. `,
      );
    }
    while (await editor.count()) {
      const count = await tabs.getByRole("tab").count();
      await editor.press("Control+w");
      await expect.poll(() => tabs.getByRole("tab").count()).toBe(count - 1);
    }
    await expect(page.locator(".start-screen")).toBeVisible();
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    report.samples.push({
      cycle,
      heapMiB: heap.usedSize / 1024 ** 2,
      ...(await cdp.send("Memory.getDOMCounters")),
    });
  }
  const [first, last] = report.samples;
  expect(last.nodes).toBeLessThanOrEqual(first.nodes + 30);
  expect(last.jsEventListeners).toBeLessThanOrEqual(
    first.jsEventListeners + 10,
  );
  expect(last.heapMiB).toBeLessThanOrEqual(first.heapMiB + 30);
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.errors.push(error.stack || String(error));
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  const output = path.join(os.tmpdir(), "alder-txt-memory-report.json");
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: output }, null, 2));
  if (
    path.dirname(profile) === path.resolve(os.tmpdir()) &&
    path.basename(profile).startsWith("alder-txt-memory-")
  )
    await fs.rm(profile, { recursive: true, force: true });
}
