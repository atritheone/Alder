import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/cell-fragments"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-cell-fragments-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", cases: [], errors: [] };
let app, page;
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const para = (text) => ({
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
function cell(prefix, count, align, wrapped) {
  const items = Array.from({ length: count }, (_, i) =>
    para(prefix + String(i).padStart(3, "0")),
  );
  if (wrapped)
    items.splice(0, items.length, {
      ...para(""),
      content: items.flatMap((p, i) => [
        ...(i ? [{ type: "hard_break" }] : []),
        ...p.content,
      ]),
    });
  return {
    type: "table_cell",
    attrs: { verticalAlign: align },
    content: items,
  };
}
const fixture = (alignment, wrapped) => ({
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        {
          type: "table_row",
          attrs: { allowSplit: true },
          content: [
            cell("LONG", 50, "top", wrapped),
            cell("SHORT", 20, alignment, wrapped),
          ],
        },
      ],
    },
    para("AFTER"),
  ],
});
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.show();
    w.focus();
  });
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  const ready = async () => {
    await expect
      .poll(() =>
        page.evaluate(() => {
          try {
            return window.__layoutProbe.pages().length;
          } catch {
            return 0;
          }
        }),
      )
      .toBeGreaterThan(1);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    return page.evaluate(() => window.__layoutProbe.pages());
  };
  for (const wrapped of [false, true])
    for (const alignment of ["middle", "bottom"]) {
      let baseline;
      for (const [scale, zoom, columns] of [
        [1, 1, 1],
        [0.5, 0.5, 1],
        [1.5, 3, 1],
        [1, 1, 2],
      ]) {
        report.current = { wrapped, alignment, scale, zoom, columns };
        fs.writeFileSync(
          path.join(directory, "progress.json"),
          JSON.stringify(report, null, 2),
        );
        await page.evaluate(
          ({ doc, scale, zoom, columns }) => {
            const probe = window.__layoutProbe;
            probe.scale(scale);
            probe.zoom(zoom);
            probe.pageSize({
              width: columns === 2 ? 1200 : 600,
              height: 529.1338582677166,
              margin: 56.69291338582678,
              columns: { count: columns, gapMm: 8, separator: false },
            });
            probe.document(doc);
          },
          { doc: fixture(alignment, wrapped), scale, zoom, columns },
        );
        const pages = await ready();
        expect(pages).toHaveLength(columns === 2 ? 2 : 4);
        const geometry = await page.evaluate(() => {
          const canvas = document.querySelector(".flow-canvas"),
            origin = canvas.getBoundingClientRect(),
            scale = origin.width / parseFloat(canvas.style.width),
            root = canvas.querySelector(".ProseMirror");
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
            result = [];
          while (walker.nextNode())
            for (const m of walker.currentNode.textContent.matchAll(
              /(?:LONG|SHORT)\d{3}/g,
            )) {
              const range = document.createRange();
              range.setStart(walker.currentNode, m.index);
              range.setEnd(walker.currentNode, m.index + m[0].length);
              const r = range.getBoundingClientRect();
              result.push({
                word: m[0],
                x: (r.left - origin.left) / scale,
                y: (r.top - origin.top) / scale,
                bottom: (r.bottom - origin.top) / scale,
                page: window.__layoutProbe.page(m[0]),
              });
            }
          return result;
        });
        expect(geometry).toHaveLength(70);
        const get = (word) => geometry.find((g) => g.word === word);
        expect(get("SHORT016").page).toBe(columns === 2 ? 0 : 1);
        expect(get("LONG048").page).toBe(columns === 2 ? 1 : 3);
        // The four short lines remaining on region 2 align within its sixteen long lines.
        expect(get("SHORT016").y - get("LONG016").y).toBeCloseTo(
          alignment === "middle" ? 144 : 288,
          0,
        );
        expect(get("SHORT000").y - get("LONG000").y).toBeCloseTo(0, 0);
        for (const g of geometry) {
          const y = g.y - g.page * (529.1338582677166 + 28),
            bottom = g.bottom - g.page * (529.1338582677166 + 28);
          expect(y, JSON.stringify(g)).toBeGreaterThan(56);
          expect(bottom, JSON.stringify(g)).toBeLessThan(473);
        }
        if (columns === 1) {
          const boundaries = pages.map(
            (p) => p.fragments || [{ from: p.from, to: p.to }],
          );
          if (baseline) expect(boundaries).toEqual(baseline);
          else baseline = boundaries;
          await page.evaluate(() => window.__layoutProbe.fullLayout());
          expect(
            (await ready()).map(
              (p) => p.fragments || [{ from: p.from, to: p.to }],
            ),
          ).toEqual(baseline);
        }
        report.cases.push({
          wrapped,
          alignment,
          scale,
          zoom,
          columns,
          short: get("SHORT016"),
          long: get("LONG016"),
        });
      }
      // Real pointer and caret at the shifted continuation text.
      const point = await page.evaluate(() => {
        window.__layoutProbe.navigate(0);
        const root = document.querySelector(".flow-canvas .ProseMirror"),
          walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const index = walker.currentNode.textContent.indexOf("SHORT016");
          if (index < 0) continue;
          walker.currentNode.parentElement.scrollIntoView({ block: "center" });
          const range = document.createRange();
          range.setStart(walker.currentNode, index);
          range.setEnd(walker.currentNode, index + 8);
          const r = range.getBoundingClientRect();
          return { x: r.left + 2, y: r.top + r.height / 2 };
        }
        throw new Error("Continuation text missing");
      });
      await page.mouse.click(point.x, point.y);
      await page.keyboard.press("Home");
      await page.keyboard.type("EDITED ");
      expect(await page.evaluate(() => window.__layoutProbe.text())).toContain(
        "EDITED SHORT016",
      );
      await page.keyboard.press("Control+z");
      expect(
        await page.evaluate(() => window.__layoutProbe.text()),
      ).not.toContain("EDITED");
      await page.evaluate(() => {
        window.__layoutProbe.scale(1);
        window.__layoutProbe.zoom(1);
      });
      await ready();
      const capture = await page.evaluate(() => window.__layoutProbe.capture());
      const file = path.join(directory, `${alignment}-${wrapped}.html`);
      fs.writeFileSync(file, capture.html);
      const bytes = await app.evaluate(async ({ BrowserWindow }, file) => {
        const w = new BrowserWindow({
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        try {
          await w.loadFile(file);
          await w.webContents.executeJavaScript(
            "document.fonts.ready.then(()=>true)",
          );
          return [
            ...(await w.webContents.printToPDF({
              preferCSSPageSize: true,
              printBackground: true,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
            })),
          ];
        } finally {
          w.destroy();
        }
      }, file);
      fs.writeFileSync(
        path.join(directory, `${alignment}-${wrapped}.pdf`),
        Buffer.from(bytes),
      );
    }
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await page
    ?.screenshot({ path: path.join(directory, "failure.png"), timeout: 5000 })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
