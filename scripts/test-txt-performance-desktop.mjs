// Developer-only measurements in disposable data; never opens the user's files.
import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const profile = await fs.mkdtemp(
  path.join(os.tmpdir(), "alder-txt-performance-"),
);
const report = {
  status: "running",
  machine: { platform: process.platform, cpu: os.cpus()[0]?.model },
  samples: [],
  errors: [],
};
let app;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [
      ".",
      "--headless-test",
      `--user-data-dir=${path.join(profile, "profile")}`,
      "--js-flags=--expose-gc",
    ],
    env: {
      ...process.env,
      ALDER_DATA_DIR: path.join(profile, "data"),
      ALDER_RESOURCES_DIR: path.resolve("work/bundle-resources"),
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(120000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "TXT text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  for (const [mib, longLine] of [
    [1, false],
    [10, false],
    [30, false],
    [1, true],
  ]) {
    const name = `Performance ${mib} MiB${longLine ? " long line" : ""}.txt`,
      filename = path.join(profile, name);
    const line = longLine
      ? "Long line keeps text available for editing. "
      : "Alder performance fixture with ordinary words and numbered paragraphs.\n";
    await fs.writeFile(
      filename,
      line
        .repeat(Math.ceil((mib * 1024 ** 2) / line.length))
        .slice(0, mib * 1024 ** 2),
    );
    const tab = page.getByRole("tab", {
        name: path.parse(name).name,
        exact: true,
      }),
      error = page.locator(".error-toast");
    const started = performance.now();
    await page
      .locator('input[aria-label="Open documents"]')
      .setInputFiles(filename);
    await expect
      .poll(async () => (await tab.count()) || (await error.count()), {
        timeout: 120000,
      })
      .toBeTruthy();
    const sample = {
      mib,
      longLine,
      openStatus: (await tab.count()) ? "opened" : "refused",
      openError: (await error.count()) ? await error.innerText() : undefined,
    };
    if (sample.openStatus === "refused") {
      sample.openMilliseconds = performance.now() - started;
    } else {
      await expect(
        page.getByRole("tab", { name: path.parse(name).name, exact: true }),
      ).toBeVisible();
      await expect(page.locator(".document-opening-progress")).toHaveCount(0);
      await editor.focus();
      await editor.press("Control+Home");
      sample.openMilliseconds = performance.now() - started;
      sample.editMilliseconds = [];
      for (let i = 0; i < 5; i++) {
        const before = performance.now();
        await editor.pressSequentially("x");
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        sample.editMilliseconds.push(performance.now() - before);
      }
      await expect(page.locator(".save-status")).toHaveText("Saved");
      await editor.press("Control+z");
      await editor.press("Control+y");
    }
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage");
    sample.heapMiB = heap.usedSize / 1024 ** 2;
    sample.dom = await cdp.send("Memory.getDOMCounters");
    report.samples.push(sample);
    console.log(JSON.stringify(sample));
    if (await error.count()) await error.getByRole("button").first().click();
    await fs.writeFile(
      path.join(os.tmpdir(), "alder-txt-performance-report.json"),
      JSON.stringify(report, null, 2),
    );
  }
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.errors.push(error.stack || String(error));
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  const output = path.join(os.tmpdir(), "alder-txt-performance-report.json");
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: output }, null, 2));
  if (
    path.dirname(profile) === path.resolve(os.tmpdir()) &&
    path.basename(profile).startsWith("alder-txt-performance-")
  )
    await fs.rm(profile, { recursive: true, force: true });
}
