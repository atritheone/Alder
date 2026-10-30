// Run from the generated testing workspace, on an isolated desktop/profile.
import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopExecutable } from "./desktop-paths.mjs";

const target = Number(process.env.ALDER_LAYOUT_PAGES || 100);
const mixedSections = process.env.ALDER_LAYOUT_SECTIONS === "1";
const hyphenation = process.env.ALDER_LAYOUT_HYPHENATION === "1";
if (![100, 500, 1000].includes(target))
  throw new Error("Choose 100, 500 or 1000 target pages.");
const directory = path.resolve("work/layout-performance");
fs.mkdirSync(directory, { recursive: true });
const reportPath = path.join(
  directory,
  `${target}${mixedSections ? "-sections" : ""}${hyphenation ? "-hyphenation" : ""}.json`,
);
const report = {
  status: "running",
  targetPages: target,
  measuredAt: new Date().toISOString(),
  machine: {
    platform: process.platform,
    architecture: process.arch,
    cpu: os.cpus()[0]?.model,
    logicalProcessors: os.cpus().length,
    memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
    font: "Cambria",
    baseline: "600 x 720 CSS pixels; 40 pixel margins; 18pt exact leading",
  },
  mixedSections,
  hyphenation,
  steps: [],
  limitations: [
    "Renderer highlight scheduling only; no audio engine or cross-platform performance certification.",
  ],
};
const save = () =>
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
save();
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "alder-layout-performance-"),
);
let app;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  await expect(
    page.getByRole("textbox", { name: "Text editor", exact: true }),
  ).toBeVisible();
  const ready = async () => {
    if (hyphenation)
      await expect
        .poll(() => page.locator(".discretionary-hyphen").count(), {
          timeout: 30000,
        })
        .toBeGreaterThan(100);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect
      .poll(async () => {
        try {
          return await page.evaluate(() => window.__layoutProbe.pages().length);
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(0);
    return page.evaluate(() =>
      window.__layoutProbe.pages().map((p) => ({
        from: p.from,
        to: p.to,
        ...(p.frame
          ? {
              frame: {
                top: p.frame.top,
                left: p.frame.left,
                width: p.frame.layout.width,
                height: p.frame.layout.height,
              },
            }
          : {}),
      })),
    );
  };
  const started = performance.now();
  await page.evaluate(
    ({ target, mixedSections, hyphenation }) => {
      window.__layoutProbe.pageSize({ width: 600, height: 720, margin: 40 });
      window.__layoutProbe.document({
        type: "doc",
        content: Array.from({ length: Math.round(target * 3.5) }, (_, i) => ({
          type: "paragraph",
          attrs: {
            blockId: `benchmark-${i}`,
            hyphenation,
            lineSpacingMode: "exact",
            lineSpacing: 18,
            spaceAfter: 0,
            spaceBefore: 0,
            widowOrphan: true,
          },
          content: [
            {
              type: "text",
              text:
                `BLOCK${i} ` +
                "A measured paragraph keeps its identity while words change. ".repeat(
                  8,
                ),
            },
          ],
        })).flatMap((node, i) =>
          mixedSections && i && i % 50 === 0
            ? [
                {
                  type: "section_break",
                  attrs: {
                    blockId: `section-${i}`,
                    kind: i % 100 ? "oddPage" : "nextPage",
                    page: {
                      pageSize: "Custom",
                      pageWidthMm: i % 100 ? 190.5 : 158.75,
                      pageHeightMm: i % 100 ? 158.75 : 190.5,
                      marginMm: (40 * 25.4) / 96,
                    },
                  },
                },
                node,
              ]
            : [node],
        ),
      });
    },
    { target, mixedSections, hyphenation },
  );
  let map = await ready();
  report.pages = map.length;
  report.initialMilliseconds = performance.now() - started;
  save();
  for (const fraction of [0, 0.5, 0.9]) {
    const profiler =
      process.env.ALDER_LAYOUT_PROFILE === "1" && fraction === 0
        ? await page.context().newCDPSession(page)
        : null;
    if (profiler) {
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.start");
    }
    const start = performance.now();
    await page.evaluate((fraction) => {
      const text = window.__layoutProbe.text();
      const at = Math.floor(text.length * fraction);
      window.__layoutProbe.edit(at, at, " measured words");
    }, fraction);
    const incremental = await ready();
    const milliseconds = performance.now() - start;
    if (profiler) {
      const data = await profiler.send("Profiler.stop");
      fs.writeFileSync(
        path.join(directory, "edit-profile.json"),
        JSON.stringify(data.profile),
      );
      await profiler.detach();
    }
    const fullStart = performance.now();
    await page.evaluate(() => window.__layoutProbe.fullLayout());
    map = await ready();
    expect(incremental).toEqual(map);
    report.steps.push({
      fraction,
      incrementalMilliseconds: milliseconds,
      fullMilliseconds: performance.now() - fullStart,
    });
    save();
  }
  report.highlight = await page.evaluate(async () => {
    const durations = [];
    for (const match of window.__layoutProbe.text().matchAll(/\S+/g)) {
      const start = performance.now();
      window.__layoutProbe.highlight(
        match.index,
        match.index + match[0].length,
      );
      durations.push(performance.now() - start);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (durations.length === 40) break;
    }
    durations.sort((a, b) => a - b);
    return {
      count: durations.length,
      medianMilliseconds: durations[20],
      p95Milliseconds: durations[38],
      maxMilliseconds: durations[39],
    };
  });
  report.layoutTimings = await page.evaluate(() =>
    window.__layoutProbe.timings(),
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  throw error;
} finally {
  save();
  await app?.close();
}
