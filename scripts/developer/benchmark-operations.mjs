// Developer operating qualification. Every scenario owns a disposable profile.
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { desktopExecutable } from "../desktop-paths.mjs";
const { values } = parseArgs({
  options: {
    resources: { type: "string" },
    output: { type: "string" },
    settle: { type: "string", default: "5000" },
    runs: { type: "string", default: "1" },
    only: { type: "string" },
  },
});
const resources = path.resolve(
  values.resources ||
    process.env.ALDER_RESOURCES_DIR ||
    "work/bundle-resources",
);
const output =
  values.output || fs.mkdtempSync(path.join(os.tmpdir(), "alder-operations-"));
fs.mkdirSync(output, { recursive: true });
const layout = JSON.parse(
  fs.readFileSync(
    new URL("../../backend/alder/runtime-layout.json", import.meta.url),
  ),
)[process.platform];
const generated = spawnSync(
  path.join(resources, layout.python),
  [
    "-B",
    fileURLToPath(new URL("opening-fixtures.py", import.meta.url)),
    path.join(output, "fixtures"),
  ],
  { encoding: "utf8", windowsHide: true },
);
if (generated.status !== 0) throw Error(generated.stderr);
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 10)
  throw Error("Choose 1�10 independent runs.");
const report = {
  platform: process.platform,
  architecture: process.arch,
  machine: {
    cpu: os.cpus()[0]?.model,
    logicalProcessors: os.cpus().length,
    memoryGiB: os.totalmem() / 1024 ** 3,
  },
  settleMs: Number(values.settle),
  status: "running",
  scenarios: [],
};
const save = () =>
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
const mod = process.platform === "darwin" ? "Meta" : "Control";
for (const filename of [
  "Small UTF8.txt",
  "Large 1MiB.txt",
  "Large 1000 paragraphs.docx",
]
  .filter((name) => !values.only || name === values.only)
  .flatMap((name) => Array(runs).fill(name))) {
  const profile = fs.mkdtempSync(path.join(output, "profile-"));
  let app;
  const sample = { filename, status: "running", editsMs: [], errors: [] };
  try {
    const env = {
      ...process.env,
      ALDER_DATA_DIR: path.join(profile, "data"),
      ALDER_RESOURCES_DIR: resources,
    };
    for (const key of ["PYTHONHOME", "PYTHONPATH", "ELECTRON_RUN_AS_NODE"])
      delete env[key];
    app = await electron.launch({
      executablePath: desktopExecutable(),
      args: [".", "--headless-test", `--user-data-dir=${profile}/chromium`],
      env,
      timeout: 60000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(60000);
    page.on("pageerror", (e) => sample.errors.push(e.message));
    await page.evaluate(() => window.alder.ready());
    await app.evaluate(() => {
      const original = globalThis.fetch;
      globalThis.unsolicitedPrepare = 0;
      globalThis.saveTraffic = [];
      globalThis.fetch = async (...args) => {
        const url = String(args[0]),
          started = performance.now();
        if (url.endsWith("/api/speech/prepare"))
          globalThis.unsolicitedPrepare++;
        const response = await original(...args);
        if (args[1]?.method === "PUT" && /\/api\/projects\/[^/]+$/.test(url))
          globalThis.saveTraffic.push({
            requestCharacters: args[1].body?.length,
            responseBytes: Number(response.headers.get("content-length")),
            headersMs: performance.now() - started,
          });
        return response;
      };
    });
    await page
      .locator(".start-screen input[type=file]")
      .setInputFiles(path.join(output, "fixtures", filename));
    const editor = page
      .locator("[contenteditable=true]")
      .filter({ hasText: "ALDER_OPEN_BEGIN" })
      .first();
    await editor.waitFor({ state: "visible", timeout: 60000 });
    await page.waitForTimeout(Number(values.settle));
    const snapshot = () =>
      page.evaluate(async () => {
        const p = await window.alder.request(
          "GET",
          `/api/projects/${localStorage.getItem("alder.project")}`,
        );
        return p.book.chapters.map((c) => c.text).join("\n");
      });
    await page.evaluate(() => {
      globalThis.operatingInputs = [];
      globalThis.operatingLongTasks = [];
      document.addEventListener(
        "beforeinput",
        () => {
          const started = performance.now();
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              globalThis.operatingInputs.push(performance.now() - started),
            ),
          );
        },
        true,
      );
      new PerformanceObserver((list) =>
        globalThis.operatingLongTasks.push(
          ...list
            .getEntries()
            .map((e) => ({ start: e.startTime, duration: e.duration })),
        ),
      ).observe({ type: "longtask" });
    });
    const before = await snapshot();
    await editor.focus();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home",
    );
    for (let i = 0; i < 18; i++) {
      const t = performance.now();
      await page.keyboard.type("x");
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      sample.editsMs.push(performance.now() - t);
    }
    const saved = () =>
      page.waitForFunction(
        () => document.querySelector(".save-status")?.textContent === "Saved",
        undefined,
        { timeout: 30000 },
      );
    const stop = performance.now();
    await saved();
    sample.quietSaveMs = performance.now() - stop;
    expect(await snapshot()).toBe("x".repeat(18) + before);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.type("x");
      await page.waitForTimeout(650);
    }
    const pause = performance.now();
    await saved();
    sample.pausedSaveMs = performance.now() - pause;
    expect(await snapshot()).toBe("x".repeat(24) + before);
    await page.keyboard.press(mod + "+z");
    await page.keyboard.press(mod + "+Shift+Z");
    await expect(page.locator(".save-status")).toHaveText("Saved", {
      timeout: 30000,
    });
    expect(await snapshot()).toBe("x".repeat(24) + before);
    sample.unsolicitedPrepare = await app.evaluate(
      () => globalThis.unsolicitedPrepare,
    );
    expect(sample.unsolicitedPrepare).toBe(0);
    sample.renderer = await page.evaluate(() => ({
      inputToTwoFramesMs: globalThis.operatingInputs,
      longTasks: globalThis.operatingLongTasks,
      heap: performance.memory
        ? {
            used: performance.memory.usedJSHeapSize,
            total: performance.memory.totalJSHeapSize,
          }
        : undefined,
    }));
    sample.saveTraffic = await app.evaluate(() => globalThis.saveTraffic);
    sample.status = sample.errors.length ? "failed" : "passed";
  } catch (error) {
    sample.status = "failed";
    sample.error = String(error.stack || error);
  } finally {
    await app?.close();
  }
  report.scenarios.push(sample);
  save();
  console.log(JSON.stringify(sample));
}
report.status = report.scenarios.every((s) => s.status === "passed")
  ? "passed"
  : "failed";
save();
if (report.status !== "passed") process.exitCode = 1;
