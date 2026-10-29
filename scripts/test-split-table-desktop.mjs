import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const directory = path.resolve("work/split-table");
fs.mkdirSync(directory, { recursive: true });
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-split-table-"));
const report = { status: "running", checks: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(6000);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1440, 1000);
    win.show();
    win.focus();
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  const paragraph = (text) => ({
    type: "paragraph",
    attrs: {
      spaceBefore: 0,
      spaceAfter: 0,
      lineSpacingMode: "exact",
      lineSpacing: 18,
      widowOrphan: false,
    },
    content: [{ type: "text", text }],
  });
  const cell = (prefix, count, header = false) => ({
    type: header ? "table_header" : "table_cell",
    attrs: { verticalAlign: "top", background: header ? "#dddddd" : "#eeeeff" },
    content: [
      {
        ...paragraph(""),
        content: Array.from({ length: count }, (_, i) => [
          ...(i ? [{ type: "hard_break" }] : []),
          { type: "text", text: `${prefix}${String(i).padStart(3, "0")}` },
        ]).flat(),
      },
    ],
  });
  const doc = {
    type: "doc",
    content: [
      paragraph("Before table"),
      {
        type: "table",
        content: [
          {
            type: "table_row",
            content: [cell("HEADLEFT", 1, true), cell("HEADRIGHT", 1, true)],
          },
          { type: "table_row", content: [cell("LEFT", 42), cell("RIGHT", 32)] },
          {
            type: "table_row",
            content: [cell("TAILLEFT", 1), cell("TAILRIGHT", 1)],
          },
        ],
      },
      paragraph("After table"),
    ],
  };
  const ready = async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          try {
            return window.__layoutProbe.capture().pages.length;
          } catch {
            return 0;
          }
        }),
      )
      .toBeGreaterThan(2);
    return page.evaluate(() => window.__layoutProbe.pages());
  };
  let baseline;
  for (const [scale, zoom] of [
    [1, 1],
    [0.5, 0.5],
    [1.5, 3],
  ]) {
    await page.evaluate(
      ({ doc, scale, zoom }) => {
        window.__layoutProbe.scale(scale);
        window.__layoutProbe.zoom(zoom);
        window.__layoutProbe.pageSize({ width: 600, height: 280, margin: 20 });
        window.__layoutProbe.document(doc);
      },
      { doc, scale, zoom },
    );
    const pages = await ready();
    expect(pages.some((page) => page.fragments?.length > 1)).toBe(true);
    const boundaries = pages.map((page) => page.fragments);
    if (baseline) expect(boundaries).toEqual(baseline);
    else baseline = boundaries;
    const measured = await page.evaluate(() => {
      const root = document.querySelector(".flow-canvas"),
        origin = root.getBoundingClientRect(),
        scale = origin.width / 600;
      const pm = root.querySelector(".ProseMirror");
      const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
      const checked = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement.closest(".pagination-spacer,.structure-marker"))
          continue;
        for (const match of node.textContent.matchAll(
          /\b(?:LEFT|RIGHT)\d{3}\b/g,
        )) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rect = range.getBoundingClientRect();
          const top = (rect.top - origin.top) / scale,
            bottom = (rect.bottom - origin.top) / scale,
            index = Math.floor(top / 308);
          checked.push({
            word: match[0],
            page: window.__layoutProbe.page(match[0]),
            actual: index,
            top: top - index * 308,
            bottom: bottom - index * 308,
          });
        }
      }
      return checked;
    });
    report.measurements = measured;
    expect(measured).toHaveLength(74);
    for (const item of measured) {
      expect(item.page, JSON.stringify(item)).toBe(item.actual);
      expect(item.top, JSON.stringify(item)).toBeGreaterThanOrEqual(19.5);
      expect(item.bottom, JSON.stringify(item)).toBeLessThanOrEqual(260.5);
    }
    expect(measured.find((item) => item.word === "RIGHT000").page).toBe(0);
    expect(
      measured.find((item) => item.word === "LEFT041").page,
    ).toBeGreaterThan(2);
    await page.evaluate(() => window.__layoutProbe.fullLayout());
    expect((await ready()).map((page) => page.fragments)).toEqual(baseline);
    report.checks.push(
      `parallel cells: exact page ownership, no text in margins, scale ${scale}, zoom ${zoom}, full-layout agreement`,
    );
  }
  await page.evaluate(() => {
    window.__layoutProbe.scale(1);
    window.__layoutProbe.zoom(1);
  });
  await ready();
  await page.evaluate(() => window.__layoutProbe.navigate(1));
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
  await page.screenshot({ path: path.join(directory, "page.png") });
  const capture = await page.evaluate(() => window.__layoutProbe.capture());
  fs.writeFileSync(path.join(directory, "pages.html"), capture.html);
  const bytes = await app.evaluate(
    async ({ BrowserWindow }, file) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      try {
        await win.loadFile(file);
        await win.webContents.executeJavaScript(
          "document.fonts.ready.then(()=>true)",
        );
        return {
          geometry: await win.webContents.executeJavaScript(
            `(()=>{const sheet=document.querySelectorAll('.publication-sheet')[1],top=sheet.getBoundingClientRect().top;return [...sheet.querySelectorAll('table,tr,.tableWrapper,.repeated-table-header')].map(e=>({tag:e.tagName,class:e.className,top:e.getBoundingClientRect().top-top,height:e.getBoundingClientRect().height,clip:getComputedStyle(e).clipPath,margin:getComputedStyle(e).marginTop}))})()`,
          ),
          bytes: [
            ...(await win.webContents.printToPDF({
              preferCSSPageSize: true,
              printBackground: true,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
            })),
          ],
        };
      } finally {
        win.destroy();
      }
    },
    path.join(directory, "pages.html"),
  );
  report.publicationGeometry = bytes.geometry;
  expect(bytes.geometry[0].top).toBe(20);
  fs.writeFileSync(path.join(directory, "pages.pdf"), Buffer.from(bytes.bytes));
  await page.evaluate(() => {
    const text = window.__layoutProbe.text();
    const at = text.indexOf("RIGHT020");
    window.__layoutProbe.edit(at, at, "Changed ");
  });
  const incremental = await ready();
  await page.evaluate(() => window.__layoutProbe.fullLayout());
  expect((await ready()).map((page) => page.fragments)).toEqual(
    incremental.map((page) => page.fragments),
  );
  expect(await page.evaluate(() => window.__layoutProbe.text())).toContain(
    "Changed RIGHT020",
  );
  await page.evaluate(() =>
    window.__layoutProbe.navigate(window.__layoutProbe.page("RIGHT020")),
  );
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 400)));
  const point = await page.evaluate(() => {
    const walker = document.createTreeWalker(
      document.querySelector(".flow-canvas .ProseMirror"),
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const at = walker.currentNode.textContent.indexOf("RIGHT020");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(walker.currentNode, at);
      range.setEnd(walker.currentNode, at + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 1, y: (rect.top + rect.bottom) / 2 };
    }
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press("Home");
  await page.keyboard.type("Typed ");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .toContain("Typed Changed RIGHT020");
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .not.toContain("Typed ");
  report.checks.push(
    "mouse caret and typing/undo in a later-page right-hand cell",
  );
  const mixed = structuredClone(doc);
  mixed.content.unshift(paragraph("First section"), {
    type: "section_break",
    attrs: {
      kind: "nextPage",
      page: { pageSize: "A5", orientation: "landscape", marginMm: 15 },
    },
  });
  mixed.content[3].content[1].content[1].content = Array.from(
    { length: 32 },
    (_, i) => paragraph(`RIGHT${String(i).padStart(3, "0")}`),
  );
  await page.evaluate((doc) => window.__layoutProbe.document(doc), mixed);
  const mixedPages = await ready();
  expect(mixedPages[0].frame.layout.width).toBe(600);
  expect(mixedPages[1].frame.layout.width).toBeGreaterThan(700);
  const mismatches = await page.evaluate(() => {
    const canvas = document.querySelector(".flow-canvas"),
      origin = canvas.getBoundingClientRect(),
      pages = window.__layoutProbe.pages(),
      scale =
        origin.width /
        Math.max(...pages.map((page) => page.frame.layout.width));
    const walker = document.createTreeWalker(
        canvas.querySelector(".ProseMirror"),
        NodeFilter.SHOW_TEXT,
      ),
      errors = [];
    while (walker.nextNode())
      for (const match of walker.currentNode.textContent.matchAll(
        /\b(?:LEFT|RIGHT)\d{3}\b/g,
      )) {
        const range = document.createRange();
        range.setStart(walker.currentNode, match.index);
        range.setEnd(walker.currentNode, match.index + match[0].length);
        const rect = range.getBoundingClientRect(),
          top = (rect.top - origin.top) / scale;
        const actual = pages.findLastIndex((page) => page.frame.top <= top),
          mapped = window.__layoutProbe.page(match[0]);
        if (mapped !== actual) errors.push({ word: match[0], mapped, actual });
      }
    return errors;
  });
  expect(mismatches).toEqual([]);
  await page.evaluate(() => window.__layoutProbe.fullLayout());
  expect((await ready()).map((page) => page.fragments)).toEqual(
    mixedPages.map((page) => page.fragments),
  );
  report.checks.push(
    "parallel paragraph cells in a differently sized section retain accurate page tracking and reflow",
  );
  expect(errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
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
