import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/mirrored-prototype"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-mirror-"));
fs.mkdirSync(directory, { recursive: true });
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
let app, page;
const report = { status: "running", errors: [], cases: [] };
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => report.errors.push(e.message));
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
  const content = [];
  for (let i = 0; i < 50; i++) {
    if (i) content.push({ type: "hard_break" });
    content.push({
      type: "text",
      text: `MIRROR${String(i).padStart(3, "0")} The line remains editable.`,
      marks: i % 2 ? [{ type: "em" }] : [],
    });
  }
  await page.evaluate((content) => {
    window.__layoutProbe.pageSize({
      width: 500,
      height: 420,
      margin: 40,
      margins: { left: 120, right: 40, top: 40, bottom: 40 },
      mirrorMargins: true,
      header: "MIRRORED_HEADER",
    });
    window.__layoutProbe.document({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            paragraphBackground: "#eef3ff",
            paragraphBorderColor: "#375678",
            paragraphBorderWidth: 1,
          },
          content,
        },
      ],
    });
  }, content);
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
    .toBeGreaterThan(3);
  const editor = page.getByRole("textbox", {
    name: "Text editor",
    exact: true,
  });
  for (const [scale, zoom] of [
    [1, 1],
    [0.5, 1],
    [1.5, 3],
  ]) {
    await page.evaluate(
      ({ scale, zoom }) => {
        window.__layoutProbe.scale(scale);
        window.__layoutProbe.zoom(zoom);
      },
      { scale, zoom },
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const result = await editor.evaluate((el) => {
      const canvas = el.closest(".flow-canvas"),
        bounds = canvas.getBoundingClientRect(),
        factor = bounds.width / 500;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
        points = [];
      let node;
      while ((node = walker.nextNode())) {
        const match = node.textContent.match(/MIRROR\d{3}/);
        if (!match) continue;
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        const physical = window.__layoutProbe.page(match[0]);
        points.push({
          label: match[0],
          page: physical,
          x: (rect.left - bounds.left) / factor,
        });
      }
      return points;
    });
    for (const point of result)
      expect(point.x).toBeCloseTo(point.page % 2 ? 40 : 120, 0);
    report.cases.push({ scale, zoom, points: result });
  }
  await page.evaluate(() => {
    window.__layoutProbe.scale(1);
    window.__layoutProbe.zoom(1);
    window.__layoutProbe.navigate(2);
  });
  const target = await editor.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.textContent.indexOf("MIRROR015");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + 6);
      range.collapse(true);
      const viewport = el.closest(".editor-scroll");
      let rect = range.getBoundingClientRect();
      const bounds = viewport.getBoundingClientRect();
      viewport.scrollTop += rect.top - bounds.top - bounds.height / 2;
      rect = range.getBoundingClientRect();
      return { x: rect.left, y: rect.top + rect.height / 2 };
    }
  });
  await page.mouse.click(target.x, target.y);
  await page.keyboard.type("X");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .toContain("MIRRORX015");
  await editor.press("Control+z");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .not.toContain("MIRRORX015");
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
    .toBeGreaterThan(0);
  const publication = await page.evaluate(() => window.__layoutProbe.capture());
  const data = await app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    try {
      await win.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      await win.webContents.executeJavaScript("document.fonts.ready");
      return (
        await win.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
        })
      ).toString("base64");
    } finally {
      win.destroy();
    }
  }, publication.html);
  fs.writeFileSync(
    path.join(directory, "mirror.pdf"),
    Buffer.from(data, "base64"),
  );
  await page.screenshot({ path: path.join(directory, "mirror.png") });
  await page.evaluate(() =>
    window.__layoutProbe.document({
      type: "doc",
      content: [
        {
          type: "table",
          content: Array.from({ length: 29 }, (_, row) => ({
            type: "table_row",
            content: [0, 1].map((column) => ({
              type: row ? "table_cell" : "table_header",
              attrs: {
                colwidth: [170],
                background: row % 2 ? "#eef3ff" : null,
              },
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: row ? `CELL${row}_${column}` : `HEADER${column}`,
                    },
                  ],
                },
              ],
            })),
          })),
        },
      ],
    }),
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
  const cells = await editor
    .locator("tr:not(.pagination-spacer) > td")
    .evaluateAll((nodes) =>
      nodes.map((cell) => {
        const canvas = cell.closest(".flow-canvas"),
          origin = canvas.getBoundingClientRect(),
          factor = origin.width / 500,
          rect = cell.getBoundingClientRect();
        return {
          label: cell.textContent,
          page: window.__layoutProbe.page(cell.textContent),
          x: (rect.left - origin.left) / factor,
        };
      }),
    );
  report.tableCells = cells;
  for (const cell of cells) {
    const column = Number(cell.label.split("_")[1]);
    expect(cell.x).toBeCloseTo(
      (cell.page % 2 ? 40 : 120) + column * 170 + 0.5,
      0,
    );
  }
  report.tableCells = cells;
  const tablePublication = await page.evaluate(() =>
    window.__layoutProbe.capture(),
  );
  const tableData = await app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    try {
      await win.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      await win.webContents.executeJavaScript("document.fonts.ready");
      return (
        await win.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
        })
      ).toString("base64");
    } finally {
      win.destroy();
    }
  }, tablePublication.html);
  fs.writeFileSync(
    path.join(directory, "mirror-table.pdf"),
    Buffer.from(tableData, "base64"),
  );
  await page.screenshot({ path: path.join(directory, "mirror-table.png") });
  await page.evaluate(() =>
    window.__layoutProbe.document({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "table_row",
              attrs: { allowSplit: true },
              content: [50, 6].map((count, column) => ({
                type: "table_cell",
                attrs: { colwidth: [170], background: "#eef3ff" },
                content: [
                  {
                    type: "paragraph",
                    content: Array.from({ length: count }, (_, line) => [
                      {
                        type: "text",
                        text: `SPLIT${column}_${String(line).padStart(3, "0")}`,
                      },
                      ...(line < count - 1 ? [{ type: "hard_break" }] : []),
                    ]).flat(),
                  },
                ],
              })),
            },
          ],
        },
      ],
    }),
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
  report.splitPoints = await editor.evaluate((el) => {
    const bounds = el.closest(".flow-canvas").getBoundingClientRect(),
      factor = bounds.width / 500,
      walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
      points = [];
    let node;
    while ((node = walker.nextNode())) {
      const match = node.textContent.match(/SPLIT(\d)_\d{3}/);
      if (!match) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      points.push({
        label: match[0],
        column: Number(match[1]),
        page: window.__layoutProbe.page(match[0]),
        x: (rect.left - bounds.left) / factor,
      });
    }
    return points;
  });
  for (const point of report.splitPoints)
    expect(point.x).toBeCloseTo(
      (point.page % 2 ? 40 : 120) + 170 * point.column + 7.5,
      0,
    );
  await page.evaluate(() => window.__layoutProbe.navigate(1));
  await page.screenshot({ path: path.join(directory, "mirror-split.png") });
  const splitPublication = await page.evaluate(() =>
    window.__layoutProbe.capture(),
  );
  const splitData = await app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    try {
      await win.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      await win.webContents.executeJavaScript("document.fonts.ready");
      return (
        await win.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
        })
      ).toString("base64");
    } finally {
      win.destroy();
    }
  }, splitPublication.html);
  fs.writeFileSync(
    path.join(directory, "mirror-split.pdf"),
    Buffer.from(splitData, "base64"),
  );
  const splitTarget=await editor.evaluate(el=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
    while(node=walker.nextNode()){
      const at=node.textContent.indexOf('SPLIT0_016');if(at<0)continue;
      const range=document.createRange();range.setStart(node,at+6);range.collapse(true);
      const viewport=el.closest('.editor-scroll'),bounds=viewport.getBoundingClientRect();let rect=range.getBoundingClientRect();viewport.scrollTop+=rect.top-bounds.top-bounds.height/2;rect=range.getBoundingClientRect();return{x:rect.left,y:rect.top+rect.height/2};
    }
  });
  await page.mouse.click(splitTarget.x,splitTarget.y);await page.keyboard.type('X');
  await expect.poll(()=>page.evaluate(()=>window.__layoutProbe.text())).toContain('SPLIT0X_016');
  await editor.press('Control+z');await expect.poll(()=>page.evaluate(()=>window.__layoutProbe.text())).not.toContain('SPLIT0X_016');
  await page.evaluate(() => {
    const mm = (px) => (px * 25.4) / 96;
    window.__layoutProbe.pageSize({
      width: 500,
      height: 420,
      margin: 40,
      margins: { top: 40, bottom: 40, left: 120, right: 40 },
      mirrorMargins: true,
      firstPageNumber: 2,
    });
    window.__layoutProbe.document({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "BEFORE_CONTINUOUS" }],
        },
        {
          type: "section_break",
          attrs: {
            kind: "continuous",
            page: {
              pageSize: "Custom",
              pageWidthMm: mm(500),
              pageHeightMm: mm(420),
              marginTopMm: mm(40),
              marginBottomMm: mm(40),
              marginLeftMm: mm(80),
              marginRightMm: mm(20),
            },
          },
        },
        {
          type: "paragraph",
          attrs: { paragraphBackground: "#eef3ff" },
          content: Array.from({ length: 35 }, (_, i) => [
            {
              type: "text",
              text: `AFTER_CONTINUOUS${String(i).padStart(3, "0")}`,
            },
            ...(i < 34 ? [{ type: "hard_break" }] : []),
          ]).flat(),
        },
      ],
    });
  });
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
  report.continuous = await editor.evaluate((el) => {
    const bounds = el.closest(".flow-canvas").getBoundingClientRect(),
      factor = bounds.width / 500,
      walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
      points = [];
    let node;
    while ((node = walker.nextNode())) {
      const match = node.textContent.match(
        /(?:BEFORE_CONTINUOUS|AFTER_CONTINUOUS\d{3})/,
      );
      if (!match) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      points.push({
        label: match[0],
        page: window.__layoutProbe.page(match[0]),
        x: (range.getBoundingClientRect().left - bounds.left) / factor,
      });
    }
    return points;
  });
  for (const point of report.continuous)
    expect(point.x).toBeCloseTo(
      point.label === "BEFORE_CONTINUOUS" ? 40 : point.page % 2 ? 80 : 20,
      0,
    );
  const before = await page.evaluate(() =>
    window.__layoutProbe.pages().map((p) => [p.from, p.to]),
  );
  await page.evaluate(() => window.__layoutProbe.fullLayout());
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
  expect(
    await page.evaluate(() =>
      window.__layoutProbe.pages().map((p) => [p.from, p.to]),
    ),
  ).toEqual(before);
  await page.evaluate(()=>{window.__layoutProbe.pageSize({width:500,height:420,margin:40,margins:{top:40,bottom:40,left:120,right:40},mirrorMargins:true});window.__layoutProbe.document({type:'doc',content:[{type:'blockquote',content:[{type:'paragraph',content:Array.from({length:35},(_,i)=>[{type:'text',text:`QUOTE${String(i).padStart(3,'0')}`},...(i<34?[{type:'hard_break'}]:[])]).flat()}]}]});});
  await expect.poll(()=>page.evaluate(()=>{try{return window.__layoutProbe.capture().pages.length}catch{return 0}})).toBeGreaterThan(2);
  report.quotes=await editor.evaluate(el=>{const bounds=el.closest('.flow-canvas').getBoundingClientRect(),factor=bounds.width/500,walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),points=[];let node;while(node=walker.nextNode()){const match=node.textContent.match(/QUOTE\d{3}/);if(!match)continue;const range=document.createRange();range.selectNodeContents(node);points.push({label:match[0],page:window.__layoutProbe.page(match[0]),x:(range.getBoundingClientRect().left-bounds.left)/factor});}return points;});
  for(const point of report.quotes)expect(point.x).toBeCloseTo(point.page%2?60:140,0);
  await page.evaluate(()=>window.__layoutProbe.navigate(1));await page.screenshot({path:path.join(directory,'mirror-quote.png')});
  expect(report.errors).toEqual([]);
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
