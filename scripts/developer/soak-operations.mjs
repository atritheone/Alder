// Real multi-document open/switch/edit/close cycles; GC is only for measuring
// retained memory, never a production workaround.
import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "../desktop-paths.mjs";
import { processResources, diskResources } from "./operating-resources.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const interval = Number(process.env.ALDER_SOAK_INTERVAL_MS || 0);
const startedAt = Date.now();
const paragraphs = Number(process.env.ALDER_MEMORY_PARAGRAPHS || 400),
  cycles = Number(process.env.ALDER_MEMORY_CYCLES || 3);
const label = process.env.ALDER_MEMORY_LABEL || "current";
if (
  !/^[a-z0-9-]+$/.test(label) ||
  !Number.isInteger(paragraphs) ||
  paragraphs < 10 ||
  paragraphs > 4000 ||
  !Number.isInteger(cycles) ||
  cycles < 1 ||
  cycles > 10
)
  throw new Error("Invalid memory fixture options.");
const directory = path.resolve(
  process.env.ALDER_SOAK_OUTPUT || `work/document-memory-${label}`,
);
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-operating-soak-"));
const report = {
  status: "running",
  paragraphs,
  cycles,
  machine: { platform: process.platform, cpu: os.cpus()[0]?.model },
  samples: [],
  switchMilliseconds: [],
  selectionFailures: [],
  historyFailures: [],
  errors: [],
};
let app, page;
const save = () =>
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [
      process.env.ALDER_SOAK_ROOT || ".",
      "--headless-test",
      `--user-data-dir=${profile}/profile`,
    ],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  const cdp = await page.context().newCDPSession(page);
  const sample = async (name) => {
    // Let pending save/layout timers and React's detached-tree cleanup finish.
    await page.waitForTimeout(1000);
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage"),
      dom = await cdp.send("Memory.getDOMCounters");
    const main = await app.evaluate(async ({ app }) => {
      const started = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        metrics: app.getAppMetrics(),
        heap: process.memoryUsage(),
        cpu: process.cpuUsage(),
        loopDelayMs: Math.max(0, performance.now() - started - 10),
      };
    });
    const snapshot = {
      name,
      elapsedMs: Date.now() - startedAt,
      main,
      processTree: processResources(app.process().pid),
      disk: diskResources(`${profile}/data`),
      heapMiB: heap.usedSize / 1024 ** 2,
      backingMiB: (heap.backingStorageSize || 0) / 1024 ** 2,
      ...dom,
      connectedElements: await page.locator("*").count(),
    };
    report.samples.push(snapshot);
    save();
    return snapshot;
  };
  await expect(page.locator(".start-screen")).toBeVisible();
  await sample("initial");
  const tabs = page.getByRole("tablist", { name: "Open documents" }),
    editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    });
  const passage = editor
    .locator("p")
    .filter({ hasText: /Passage \d+-\d+-0\./ })
    .first();
  for (let cycle = 0; cycle < cycles; cycle++) {
    const cycleStarted = Date.now();
    const files = [];
    for (let i = 0; i < 3; i++) {
      const file = path.join(profile, `Memory ${cycle}-${i}.md`);
      const paragraph =
        "A manuscript can retain its wording, paragraphs and editing history while moving between open documents. Returning to a document should restore the exact selection, and closing it should release the resources that are no longer needed. ".repeat(
          3,
        );
      fs.writeFileSync(
        file,
        Array.from(
          { length: paragraphs },
          (_, j) => `Passage ${cycle}-${i}-${j}. ${paragraph}`,
        ).join("\n\n"),
      );
      files.push(file);
    }
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page
      .getByRole("button", { name: "Word Document", exact: false })
      .click();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(editor).toBeVisible();
    // Exercise the real input/change/import path with File payloads. CDP's
    // native file-input command pins its element (and detached ancestors) in
    // the inspector, which would measure debugger retention across cycles.
    await page.evaluate(
      (files) => {
        const input = document.querySelector(
          'input[aria-label="Open documents"]',
        );
        const transfer = new DataTransfer();
        for (const file of files)
          transfer.items.add(
            new File([file.text], file.name, { type: "text/plain" }),
          );
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      files.map((file) => ({
        name: path.basename(file),
        text: fs.readFileSync(file, "utf8"),
      })),
    );
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      await tabs
        .getByRole("tab", { name: `Memory ${cycle}-${i}`, exact: true })
        .click();
      await expect(passage).toContainText(`Passage ${cycle}-${i}-0.`);
      report.switchMilliseconds.push(performance.now() - start);
      await page.evaluate(() => {
        const editor = document.querySelector(
            '[aria-label="Chapter text editor"]',
          ),
          el = [...editor.querySelectorAll("p")].find((p) =>
            /Passage \d+-\d+-0\./.test(p.textContent),
          );
        editor.focus();
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(true);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await editor.pressSequentially(`Edit ${i}. `);
      await expect(page.locator(".save-status")).toHaveText("Saved");
    }
    await sample(`open-${cycle}`);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator(".publication-page-text p")).toContainText(
      "Passage",
      { timeout: 90000 },
    );
    await page
      .getByRole("button", { name: "Reflowable reading", exact: true })
      .click();
    await expect(
      page
        .frameLocator('iframe[title="Reflowable publication preview"]')
        .locator("body"),
    ).toContainText("Passage");
    await page
      .getByRole("button", { name: "Back To Write", exact: true })
      .click();
    for (let i = 0; i < 3; i++) {
      await tabs
        .getByRole("tab", { name: `Memory ${cycle}-${i}`, exact: true })
        .click();
      await expect(passage).toContainText(`Edit ${i}. `);
      // Text inserted without resetting the selection must return to this
      // document's saved caret, rather than the preceding tab's caret.
      const prefix = () =>
        page.evaluate(() =>
          document
            .querySelector('[aria-label="Chapter text editor"]')
            .textContent.slice(0, 200),
        );
      const before = await prefix();
      await editor.pressSequentially("Caret. ");
      const after = await prefix();
      if (!(await passage.textContent()).includes(`Edit ${i}. Caret. Passage`))
        report.selectionFailures.push({ cycle, document: i, before, after });
      await editor.press(
        (process.platform === "darwin" ? "Meta" : "Control") + "+z",
      );
      try {
        await expect.poll(prefix, { timeout: 2000 }).toBe(before);
      } catch {
        report.historyFailures.push({
          cycle,
          document: i,
          action: "undo",
          actual: await prefix(),
        });
      }
      await editor.press(
        (process.platform === "darwin" ? "Meta" : "Control") + "+Shift+Z",
      );
      try {
        await expect.poll(prefix, { timeout: 2000 }).toBe(after);
      } catch {
        report.historyFailures.push({
          cycle,
          document: i,
          action: "redo",
          actual: await prefix(),
        });
      }
    }
    await tabs
      .getByRole("tab", { name: `Memory ${cycle}-0`, exact: true })
      .click();
    await expect(passage).toContainText(`Passage ${cycle}-0-0.`);
    await page.evaluate(() => {
      const editor = document.querySelector(
          '[aria-label="Chapter text editor"]',
        ),
        el = [...editor.querySelectorAll("p")].find((p) =>
          /Passage \d+-\d+-0\./.test(p.textContent),
        );
      editor.focus();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let text;
      const nodes = [];
      while ((text = walker.nextNode())) if (text.textContent) nodes.push(text);
      if (!nodes.length) throw new Error("Editable passage not found.");
      let remaining = 4,
        end = nodes[0];
      for (const node of nodes) {
        end = node;
        if (remaining <= node.textContent.length) break;
        remaining -= node.textContent.length;
      }
      getSelection().setBaseAndExtent(end, remaining, nodes[0], 0);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await expect(page.locator(".writing-word-count")).toHaveText(/^1 Word/);
    await tabs
      .getByRole("tab", { name: `Memory ${cycle}-1`, exact: true })
      .click();
    await expect(passage).toContainText(`Passage ${cycle}-1-0.`);
    await tabs
      .getByRole("tab", { name: `Memory ${cycle}-0`, exact: true })
      .click();
    await expect(passage).toContainText(`Passage ${cycle}-0-0.`);
    await editor.focus();
    await expect
      .poll(() => page.evaluate(() => getSelection().toString()))
      .toBe("Edit");
    await expect
      .poll(() =>
        page.evaluate(
          () => getSelection().anchorOffset > getSelection().focusOffset,
        ),
      )
      .toBe(true);
    while (await editor.isVisible()) {
      const count = await tabs.getByRole("tab").count();
      await page.keyboard.press(
        (process.platform === "darwin" ? "Meta" : "Control") + "+w",
      );
      if (count > 1) await expect(tabs.getByRole("tab")).toHaveCount(count - 1);
      else await expect(page.locator(".start-screen")).toBeVisible();
    }
    const closed = await sample(`closed-${cycle}`),
      initial = report.samples[0];
    const warmed = report.samples.find((value) => value.name === "closed-0");
    expect(closed.connectedElements).toBe(warmed.connectedElements);
    expect(closed.nodes).toBeLessThanOrEqual(warmed.nodes + 20);
    expect(closed.backingMiB).toBeLessThanOrEqual(warmed.backingMiB + 0.25);
    expect(closed.jsEventListeners).toBeLessThanOrEqual(
      warmed.jsEventListeners + 5,
    );
    if (interval && cycle < cycles - 1)
      await page.waitForTimeout(
        Math.max(0, interval - (Date.now() - cycleStarted)),
      );
    console.log(
      JSON.stringify({
        cycle,
        status: "passed",
        elapsedMs: Date.now() - startedAt,
        closedHeapMiB: closed.heapMiB,
      }),
    );
  }
  if (process.env.ALDER_MEMORY_HEAP === "1") {
    const output = fs.openSync(
      path.join(directory, "closed.heapsnapshot"),
      "w",
    );
    const chunk = ({ chunk }) => fs.writeSync(output, chunk);
    cdp.on("HeapProfiler.addHeapSnapshotChunk", chunk);
    try {
      await cdp.send("HeapProfiler.takeHeapSnapshot");
    } finally {
      cdp.off("HeapProfiler.addHeapSnapshotChunk", chunk);
      fs.closeSync(output);
    }
  }
  expect(report.errors).toEqual([]);
  expect(report.selectionFailures).toEqual([]);
  expect(report.historyFailures).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  process.exitCode = 1;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
} finally {
  save();
  if (report.status === "failed")
    await app?.evaluate(({ app }) => app.exit(1)).catch(() => {});
  await app?.close().catch(() => {});
}
