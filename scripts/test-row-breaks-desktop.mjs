import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/row-breaks");
fs.mkdirSync(directory, { recursive: true });
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-row-breaks-"));
const report = { status: "running", checks: [] };
let app, page;
const p = (text) => ({
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
  content: Array.from({ length: count }, (_, i) =>
    p(`${prefix}${String(i).padStart(3, "0")}`),
  ),
});
const fixture = (allowSplit) => ({
  type: "doc",
  content: [
    ...Array.from({ length: 6 }, (_, i) => p(`INTRO${i}`)),
    {
      type: "table",
      attrs: { blockId: "rows" },
      content: [
        {
          type: "table_row",
          content: [cell("HEADLEFT", 1, true), cell("HEADRIGHT", 1, true)],
        },
        {
          type: "table_row",
          attrs: { allowSplit },
          content: [cell("LEFT", 8), cell("RIGHT", 6)],
        },
        {
          type: "table_row",
          attrs: { allowSplit: true },
          content: [cell("TAILLEFT", 8), cell("TAILRIGHT", 7)],
        },
      ],
    },
    p("AFTER"),
  ],
});
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
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
      .toBeGreaterThan(1);
    return page.evaluate(() => window.__layoutProbe.pages());
  };
  for (const allowSplit of [false, true]) {
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
          window.__layoutProbe.pageSize({
            width: 600,
            height: 400,
            margin: 20,
          });
          window.__layoutProbe.document(doc);
        },
        { doc: fixture(allowSplit), scale, zoom },
      );
      const pages = await ready();
      const measured = await page.evaluate(() => {
        const origin = document
            .querySelector(".flow-canvas")
            .getBoundingClientRect(),
          scale = origin.width / 600,
          walker = document.createTreeWalker(
            document.querySelector(".flow-canvas .ProseMirror"),
            NodeFilter.SHOW_TEXT,
          ),
          result = [];
        while (walker.nextNode())
          for (const match of walker.currentNode.textContent.matchAll(
            /\b(?:LEFT|RIGHT|TAILLEFT|TAILRIGHT)\d{3}\b/g,
          )) {
            const range = document.createRange();
            range.setStart(walker.currentNode, match.index);
            range.setEnd(walker.currentNode, match.index + match[0].length);
            const rect = range.getBoundingClientRect(),
              top = (rect.top - origin.top) / scale,
              actual = Math.floor(top / 428);
            result.push({
              word: match[0],
              actual,
              mapped: window.__layoutProbe.page(match[0]),
              top: top - actual * 428,
              bottom: (rect.bottom - origin.top) / scale - actual * 428,
            });
          }
        return result;
      });
      expect(measured).toHaveLength(29);
      for (const m of measured) {
        expect(m.mapped, JSON.stringify(m)).toBe(m.actual);
        expect(m.top, JSON.stringify(m)).toBeGreaterThanOrEqual(19.5);
        expect(m.bottom, JSON.stringify(m)).toBeLessThanOrEqual(380.5);
      }
      expect(measured.find((m) => m.word === "LEFT000").mapped).toBe(
        allowSplit ? 0 : 1,
      );
      if (!allowSplit)
        expect(
          new Set(
            measured
              .filter((m) => /^(LEFT|RIGHT)/.test(m.word))
              .map((m) => m.mapped),
          ).size,
        ).toBe(1);
      else
        expect(
          new Set(
            measured.filter((m) => /^LEFT/.test(m.word)).map((m) => m.mapped),
          ).size,
        ).toBe(2);
      const boundaries = pages.map(
        (p) => p.fragments || [{ from: p.from, to: p.to }],
      );
      if (baseline) expect(boundaries).toEqual(baseline);
      else baseline = boundaries;
      await page.evaluate(() => window.__layoutProbe.fullLayout());
      expect(
        (await ready()).map((p) => p.fragments || [{ from: p.from, to: p.to }]),
      ).toEqual(baseline);
    }
    report.checks.push(
      `${allowSplit ? "split" : "keep"} rows: ownership, alignment, scaling and full layout agree`,
    );
    await page.evaluate(() => {
      window.__layoutProbe.scale(1);
      window.__layoutProbe.zoom(1);
      window.__layoutProbe.capturePages(true);
    });
    await ready();
    await expect
      .poll(() => page.evaluate(() => window.__layoutProbe.snapshots().length))
      .toBeGreaterThan(1);
    const snapshot = await page.evaluate(() => ({
      capture: window.__layoutProbe.capture(),
      snapshots: window.__layoutProbe.snapshots(),
      tableGeometry: [
        ...document.querySelectorAll(
          ".flow-canvas .ProseMirror table,.flow-canvas .ProseMirror tr",
        ),
      ].map((e) => ({
        tag: e.tagName,
        height: e.getBoundingClientRect().height,
        clip: getComputedStyle(e).clipPath,
      })),
    }));
    fs.writeFileSync(
      path.join(directory, `${allowSplit}.html`),
      snapshot.capture.html,
    );
    report[allowSplit ? "split" : "keep"] = {
      pages: snapshot.capture.pages,
      snapshots: snapshot.snapshots.length,
      tableGeometry: snapshot.tableGeometry,
    };
    const bytes = await app.evaluate(
      async ({ BrowserWindow }, file) => {
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
          return {
            geometry: await w.webContents.executeJavaScript(
              `([...document.querySelectorAll('.publication-sheet:last-child .tableWrapper table,.publication-sheet:last-child .tableWrapper tr')].map(e=>({tag:e.tagName,height:e.getBoundingClientRect().height,clip:getComputedStyle(e).clipPath})))`,
            ),
            bytes: [
              ...(await w.webContents.printToPDF({
                preferCSSPageSize: true,
                printBackground: true,
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
              })),
            ],
          };
        } finally {
          w.destroy();
        }
      },
      path.join(directory, `${allowSplit}.html`),
    );
    fs.writeFileSync(
      path.join(directory, `${allowSplit}.pdf`),
      Buffer.from(bytes.bytes),
    );
    report[allowSplit ? "split" : "keep"].printedGeometry = bytes.geometry;
  }
  // Use the actual dialog, selection and undo, then edit a continuation cell.
  await page.evaluate(() => window.__layoutProbe.navigate(0));
  await page.getByText("LEFT000", { exact: true }).click();
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .last()
    .click();
  await page
    .getByRole("menuitem", { name: "Table properties…", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Table properties",
    exact: true,
  });
  await expect(dialog.getByLabel("Row breaks", { exact: true })).toHaveValue(
    "true",
  );
  await dialog.getByLabel("Row breaks", { exact: true }).selectOption("false");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await ready();
  expect(await page.evaluate(() => window.__layoutProbe.page("LEFT000"))).toBe(
    1,
  );
  await page.locator(".flow-canvas .ProseMirror").press("Control+z");
  await ready();
  report.afterUndo = await page.evaluate(() => ({
    doc: window.__layoutProbe.doc(),
    active: document.activeElement?.outerHTML.slice(0, 200),
  }));
  expect(await page.evaluate(() => window.__layoutProbe.page("LEFT000"))).toBe(
    0,
  );
  const clipboard = await page.evaluate(() =>
    window.__layoutProbe.clipboardRoundTrip(window.__layoutProbe.doc()),
  );
  expect(
    clipboard.find((n) => n.type === "table").content[1].attrs.allowSplit,
  ).toBe(true);
  await page.evaluate(() =>
    window.__layoutProbe.navigate(window.__layoutProbe.page("RIGHT005")),
  );
  await page.getByText("RIGHT005", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.type("EDITED ");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .toContain("EDITED RIGHT005");
  const edited = await ready();
  await page.evaluate(() => window.__layoutProbe.fullLayout());
  expect((await ready()).map((p) => p.fragments)).toEqual(
    edited.map((p) => p.fragments),
  );
  report.checks.push(
    "actual row properties, undo, clipboard, continuation-cell typing and reflow",
  );
  const nearBottom = fixture(true);
  nearBottom.content.unshift(...Array.from({length:7},(_,i)=>p(`EXTRA${i}`)));
  await page.evaluate(doc=>window.__layoutProbe.document(doc),nearBottom);await ready();
  expect(await page.evaluate(()=>window.__layoutProbe.page('HEADLEFT000'))).toBe(1);
  expect(await page.evaluate(()=>window.__layoutProbe.page('LEFT000'))).toBe(1);
  report.checks.push('headers retain the first body line when only the header would fit');
  const aligned = fixture(false);
  aligned.content[6].content[1].content[0].attrs = { verticalAlign: "middle" };
  aligned.content[6].content[1].content[1].attrs = { verticalAlign: "bottom" };
  await page.evaluate((doc) => window.__layoutProbe.document(doc), aligned);
  await ready();
  const alignmentCapture = await page.evaluate(() =>
    window.__layoutProbe.capture(),
  );
  const alignmentFile = path.join(directory, "alignment.html");
  fs.writeFileSync(alignmentFile, alignmentCapture.html);
  const offsets = await app.evaluate(async ({ BrowserWindow }, file) => {
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
      return await w.webContents.executeJavaScript(
        `([...document.querySelectorAll('.tableWrapper [data-publication-top]')].map(e=>{const sheet=e.closest('.publication-sheet').getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const rect=range.getBoundingClientRect();return {text:e.textContent,dy:rect.top-sheet.top-Number(e.dataset.publicationTop),dx:rect.left-sheet.left-Number(e.dataset.publicationLeft)}}))`,
      );
    } finally {
      w.destroy();
    }
  }, alignmentFile);
  for (const offset of offsets) {
    expect(Math.abs(offset.dy), JSON.stringify(offset)).toBeLessThan(1);
    expect(Math.abs(offset.dx), JSON.stringify(offset)).toBeLessThan(1);
  }
  report.checks.push(
    "publication cell positions preserve middle/bottom alignment within one logical pixel",
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
