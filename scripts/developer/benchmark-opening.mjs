// Developer qualification only. Every launch gets disposable application data.
import { _electron as electron } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { desktopExecutable } from "../desktop-paths.mjs";

const { values } = parseArgs({ options: {
  packaged: { type: "boolean" }, resources: { type: "string" }, executable: { type: "string" },
  output: { type: "string" }, runs: { type: "string", default: "10" },
  "startup-only": { type: "boolean" }, "settle-ms": { type: "string", default: "10000" },
  "max-core-ms": { type: "string" }, "max-edit-ms": { type: "string" },
} });
const runs = Number(values.runs), settle = Number(values["settle-ms"]);
if (!Number.isInteger(runs) || runs < 1 || runs > 50 || !Number.isFinite(settle) || settle < 0 || settle > 30000) throw Error("Invalid benchmark limits.");
const output = values.output ? path.resolve(values.output) : fs.mkdtempSync(path.join(os.tmpdir(), "alder-opening-benchmark-"));
fs.mkdirSync(output, { recursive: true });
const executable = values.executable || desktopExecutable(values.packaged);
const resources = path.resolve(values.resources || process.env.ALDER_RESOURCES_DIR || (values.packaged
  ? path.join(path.dirname(executable), process.platform === "darwin" ? "../Resources" : "resources") : "work/bundle-resources"));
const layout = JSON.parse(fs.readFileSync(new URL("../../backend/alder/runtime-layout.json", import.meta.url)))[process.platform];
const report = { schemaVersion: 1, status: "running", platform: process.platform, architecture: process.arch,
  cpu: os.cpus()[0]?.model, packaged: !!values.packaged, startup: [], opening: [], errors: [] };
function save() { fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2)); }
async function launch(name) {
  const profile = fs.mkdtempSync(path.join(output, name + "-"));
  const env = { ...process.env, ALDER_DATA_DIR: path.join(profile, "data"), ALDER_PERFORMANCE_OUTPUT: path.join(profile, "performance.json") };
  for (const key of ["PYTHONHOME", "PYTHONPATH", "ELECTRON_RUN_AS_NODE"]) delete env[key];
  if (!values.packaged) env.ALDER_RESOURCES_DIR = resources;
  const started = performance.now();
  const app = await electron.launch({ executablePath: executable,
    args: [...(values.packaged ? [] : [path.resolve(".")]), "--headless-test", `--user-data-dir=${path.join(profile, "chromium")}`], env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on("pageerror", error => report.errors.push(error.message));
  await page.locator(".start-screen").waitFor({ state: "attached", timeout: 60000 });
  const shellMs = performance.now() - started;
  await page.evaluate(() => window.alder.ready());
  const coreMs = performance.now() - started;
  return { app, page, profile, shellMs, coreMs };
}
try {
  for (let index = 0; index < runs; index++) {
    let app;
    try {
      const sample = await launch("startup"); app = sample.app;
      report.startup.push({ shellMs: sample.shellMs, coreMs: sample.coreMs,
        milestones: await sample.page.evaluate(() => window.alder.performance()) });
      save();
    } finally { await app?.close(); }
  }
  if (!values["startup-only"]) {
    const fixtures = path.join(output, "fixtures");
    const generated = spawnSync(path.join(resources, layout.python), ["-B", fileURLToPath(new URL("opening-fixtures.py", import.meta.url)), fixtures], { windowsHide: true, encoding: "utf8" });
    if (generated.status !== 0) throw Error(generated.stderr);
    const inputs = JSON.parse(fs.readFileSync(path.join(fixtures, "fixtures.json")));
    for (const input of inputs) {
      let app;
      const result = { name: input.name, bytes: input.bytes, status: "running" };
      try {
        const sample = await launch("document"); app = sample.app;
        const page = sample.page;
        page.setDefaultTimeout(120000);
        await page.evaluate(() => {
          globalThis.openingTasks = [];
          new PerformanceObserver(list => globalThis.openingTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: "longtask" });
        });
        const started = performance.now();
        await page.locator('.start-screen input[type="file"]').setInputFiles(path.join(fixtures, input.name));
        if (input.expectedRefusal) {
          await page.locator('[role="alert"]').first().waitFor();
          result.openMs = performance.now() - started;
          result.preserved = await page.evaluate(async () => !(await window.alder.request("GET", "/api/projects")).projects.length);
        } else {
          await page.waitForFunction(() => !document.querySelector(".document-opening-progress") && [...document.querySelectorAll('[contenteditable="true"]')].some(n => n.textContent.includes("ALDER_OPEN_BEGIN")));
          result.openMs = performance.now() - started;
          const content = await page.evaluate(async () => {
            const p = await window.alder.request("GET", `/api/projects/${localStorage.getItem("alder.project")}`);
            const text = p.book.chapters.map(c => c.text).join("\n"), nodes = {}, marks = {};
            const walk = n => { nodes[n.type] = (nodes[n.type] || 0) + 1; for (const m of n.marks || []) marks[m.type] = true; for (const c of n.content || []) walk(c); };
            for (const chapter of p.book.chapters) walk(chapter.document);
            return { sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), b => b.toString(16).padStart(2, "0")).join(""),
              begin: text.includes("ALDER_OPEN_BEGIN"), end: text.includes("ALDER_OPEN_END"), nodes, marks };
          });
          result.preserved = content.begin && content.end && (!input.expectedTextSha256 || content.sha256 === input.expectedTextSha256);
          if (input.expectFormatting) result.preserved &&= !!(content.nodes.heading && content.nodes.table && content.nodes.inline_image && content.marks.strong && content.marks.em);
          const editor = page.locator('[contenteditable="true"]').filter({ hasText: "ALDER_OPEN_BEGIN" }).first();
          await editor.focus();
          await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home");
          result.editsMs = [];
          for (let key = 0; key < 3; key++) {
            const edit = performance.now(); await page.keyboard.type("x");
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            result.editsMs.push(performance.now() - edit);
          }
          await page.keyboard.press((process.platform === "darwin" ? "Meta" : "Control") + "+z");
          await new Promise(resolve => setTimeout(resolve, settle));
          result.longTasks = await page.evaluate(() => globalThis.openingTasks);
          result.backend = await page.evaluate(() => window.alder.request("GET", "/api/performance"));
        }
        result.status = result.preserved ? "passed" : "failed";
      } catch (error) { result.status = "failed"; result.error = String(error.stack || error); }
      finally { await app?.close(); }
      report.opening.push(result); save();
      console.log(JSON.stringify({ ...result, longTasks: undefined, backend: undefined }));
    }
  }
  const median = list => { const sorted = [...list].sort((a, b) => a - b); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2; };
  report.summary = { shellMedianMs: median(report.startup.map(s => s.shellMs)), coreMedianMs: median(report.startup.map(s => s.coreMs)),
    coreMaxMs: Math.max(...report.startup.map(s => s.coreMs)), longestEditMs: Math.max(0, ...report.opening.flatMap(s => s.editsMs || [])) };
  report.status = !report.errors.length && report.opening.every(s => s.status === "passed") &&
    report.summary.coreMedianMs <= Number(values["max-core-ms"] || Infinity) && report.summary.longestEditMs <= Number(values["max-edit-ms"] || Infinity) ? "passed" : "failed";
} catch (error) { report.status = "failed"; report.errors.push(String(error.stack || error)); }
save();
console.log(JSON.stringify({ status: report.status, summary: report.summary, report: path.join(output, "report.json") }));
if (report.status !== "passed") process.exitCode = 1;
