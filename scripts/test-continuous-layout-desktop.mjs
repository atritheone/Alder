import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/continuous-layout");
fs.mkdirSync(directory, { recursive: true });
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), "alder-continuous-layout-"),
  ),
  report = { status: "running", checks: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(7000);
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
  const ready = async () => {
    await expect
      .poll(async () => {
        try {
          return await page.evaluate(() => window.__layoutProbe.pages().length);
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(1);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    return page.evaluate(() => window.__layoutProbe.pages());
  };
  await page.evaluate(() => {
    const p = window.__layoutProbe,
      content = [];
    for (let i = 0; i < 600; i++) {
      if ([17, 18, 240, 410].includes(i))
        content.push({
          type: "section_break",
          attrs: {
            kind: "continuous",
            page: {
              pageSize: "A4",
              marginTopMm: i === 240 ? 40 : 22,
              marginBottomMm: 22,
              marginLeftMm: i < 240 ? 35 : 22,
              marginRightMm: 22,
            },
            numberingStart: i === 18 ? 9 : null,
            runningMatter: {
              header: {
                default: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: `Section ${i}` }],
                    },
                  ],
                },
              },
            },
          },
        });
      if (i === 400)
        content.push({
          type: "section_break",
          attrs: { kind: "nextPage", page: { pageSize: "A4", marginMm: 22 } },
        });
      content.push({
        type: "paragraph",
        attrs: { spaceAfter: 0 },
        content: [
          {
            type: "text",
            text: `PARA_${i} A short original line for pagination.`,
          },
        ],
      });
    }
    p.document({ type: "doc", content });
  });
  const initial = await ready();
  for (const marker of ["PARA_19", "PARA_245", "PARA_415", "PARA_590"]) {
    const start = Date.now();
    await page.evaluate((marker) => {
      const p = window.__layoutProbe,
        at = p.text().indexOf(marker);
      p.edit(at, at, "Edited ");
    }, marker);
    const incremental = await ready(),
      elapsed = Date.now() - start;
    await page.evaluate(() => window.__layoutProbe.fullLayout());
    const full = await ready();
    expect(incremental).toEqual(full);
    report.checks.push({
      marker,
      pages: full.length,
      workflowMsIncludingPolling: elapsed,
      timings: await page.evaluate(() =>
        window.__layoutProbe.timings().slice(-2),
      ),
    });
  }
  // Reflow following a paragraph growing across several sheets must retain
  // pending running stories and numbering through subsequent continuous breaks.
  await page.evaluate(() => {
    const p = window.__layoutProbe,
      at = p.text().indexOf("PARA_16");
    p.edit(at, at, "Long additional text. ".repeat(1700));
  });
  const grown = await ready();
  expect(grown.length).toBeGreaterThan(initial.length);
  await page.evaluate(() => window.__layoutProbe.fullLayout());
  expect(await ready()).toEqual(grown);
  report.checks.push({
    growthPages: grown.length,
    incrementalMatchesFull: true,
  });
  const body = page.getByRole("textbox", { name: "Text editor", exact: true });
  await body.press("Control+End");
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page.getByRole("menuitem", { name: /^Section properties/ }).click();
  await expect(page.getByLabel("Section start")).toHaveValue("continuous");
  await page.getByLabel("Section start").selectOption("nextPage");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await ready();
  await body.press("Control+z");
  const undone = await ready();
  expect(undone).toEqual(grown);
  report.checks.push(
    "Section properties changes continuous flow and restores it with one undo.",
  );
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
