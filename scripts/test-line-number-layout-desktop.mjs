import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/line-number-layout"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-line-layout-"));
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
const text = (text, marks = []) => ({ type: "text", text, marks });
const para = (i) => ({
  type: "paragraph",
  attrs: {
    spaceBefore: 0,
    spaceAfter: 0,
    lineSpacingMode: "exact",
    lineSpacing: 30,
    widowOrphan: false,
  },
  content: [
    text(`ROW${String(i).padStart(3, "0")} `),
    text("x"),
    text("2", [{ type: "superscript" }]),
    text(" y"),
    text("2", [{ type: "subscript" }]),
    text(" BIG", [
      {
        type: "text_style",
        attrs: { fontSize: 22, fontFamily: i % 2 ? "Arial" : "Cambria" },
      },
    ]),
  ],
});
const doc = {
  type: "doc",
  content: Array.from({ length: 100 }, (_, i) => para(i)),
};
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
            return window.__layoutProbe
              .pages()
              .flatMap((p) => p.lineNumbers || []).length;
          } catch {
            return 0;
          }
        }),
      )
      .toBeGreaterThan(0);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    return page.evaluate(() => window.__layoutProbe.pages());
  };
  for (const wrapped of [false, true, "empty"])
    for (const [scale, zoom, columns] of [
      [1, 1, 1],
      [0.5, 0.5, 1],
      [1.5, 3, 1],
      [1, 1, 2],
    ]) {
      const document = wrapped
        ? {
            type: "doc",
            content: [
              {
                ...para(0),
                content: doc.content.flatMap((p, i) => [
                  ...(i ? [{ type: "hard_break" }] : []),
                  ...(wrapped === "empty" && i % 4 === 3 ? [] : p.content),
                ]),
              },
            ],
          }
        : doc;
      await page.evaluate(
        ({ doc, scale, zoom, columns }) => {
          const p = window.__layoutProbe;
          p.scale(scale);
          p.zoom(zoom);
          p.pageSize({
            width: columns === 2 ? 1200 : 600,
            height: 800,
            margin: 60,
            columns: { count: columns, gapMm: 8, separator: false },
            lineNumbering: {
              start: 1,
              step: 1,
              distance: 6,
              restart: "continuous",
            },
          });
          p.document(doc);
        },
        { doc: document, scale, zoom, columns },
      );
      const pages = await ready(),
        numbers = pages
          .flatMap((p) => p.lineNumbers || [])
          .map((n) => n.number);
      report.cases.push({
        wrapped,
        scale,
        zoom,
        columns,
        pages: pages.length,
        numbers,
      });
      expect(numbers).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
      const measured = await page.evaluate(() => {
        const canvas = document.querySelector(".flow-canvas"),
          r = canvas.getBoundingClientRect(),
          scale = r.width / parseFloat(canvas.style.width),
          walker = document.createTreeWalker(
            canvas.querySelector(".ProseMirror"),
            NodeFilter.SHOW_TEXT,
          ),
          result = [];
        while (walker.nextNode())
          for (const m of walker.currentNode.textContent.matchAll(
            /ROW\d{3}/g,
          )) {
            const range = document.createRange();
            range.setStart(walker.currentNode, m.index);
            range.setEnd(walker.currentNode, m.index + m[0].length);
            result.push({
              index: Number(m[0].slice(3)),
              y: (range.getBoundingClientRect().top - r.top) / scale,
            });
          }
        return result;
      });
      const flat = pages.flatMap((p, i) =>
        (p.lineNumbers || []).map((n) => (p.frame?.top ?? i * 828) + n.y),
      );
      for (const m of measured)
        expect(flat[m.index] - flat[0]).toBeCloseTo(m.y - measured[0].y, 0);
      await page.evaluate(() => window.__layoutProbe.edit(0, 0, "EDIT "));
      const edited = await ready();
      await page.evaluate(() => window.__layoutProbe.fullLayout());
      const fresh = await ready();
      expect(fresh.map((p) => p.lineNumbers)).toEqual(
        edited.map((p) => p.lineNumbers),
      );
    }
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  report.geometry = await page
    ?.evaluate(() => {
      const p = document.querySelector(".flow-canvas .ProseMirror p"),
        walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT),
        a = [],
        ctx = document.createElement("canvas").getContext("2d");
      while (walker.nextNode()) {
        const n = walker.currentNode,
          el = n.parentElement,
          css = getComputedStyle(el),
          r = document.createRange();
        r.selectNodeContents(n);
        ctx.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
        a.push({
          text: n.textContent,
          html: el.outerHTML,
          rect: [...r.getClientRects()].map((r) => ({
            x: r.x,
            y: r.y,
            h: r.height,
          })),
          font: ctx.font,
          ascent: ctx.measureText("Mg").fontBoundingBoxAscent,
          descent: ctx.measureText("Mg").fontBoundingBoxDescent,
          va: css.verticalAlign,
          line: css.lineHeight,
          top: css.top,
          transform: css.transform,
        });
      }
      return a;
    })
    .catch(() => null);
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
