import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/table-pagination");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "alder-table-pagination-"),
);
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const report = { status: "running", checks: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
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
  const paragraph = (text) => ({
    type: "paragraph",
    attrs: {
      spaceAfter: 0,
      spaceBefore: 0,
      lineSpacingMode: "exact",
      lineSpacing: 18,
      widowOrphan: false,
    },
    content: [{ type: "text", text }],
  });
  const cell = (text, header = false, attrs = {}) => ({
    type: header ? "table_header" : "table_cell",
    attrs,
    content: [paragraph(text)],
  });
  const row = (cells) => ({ type: "table_row", content: cells });
  const content = [
    paragraph("Before table"),
    {
      type: "table",
      content: [
        row([cell("HEADER_ONE", true), cell("HEADER_TWO", true)]),
        ...Array.from({ length: 32 }, (_, i) =>
          row([cell(`ROW${i}`), cell(`VALUE${i}`)]),
        ),
      ],
    },
    paragraph("After table"),
  ];
  let baselinePages;
  const pageMap = (pages) =>
    pages.map(({ header, ...page }) => ({
      ...page,
      header: header && {
        ...header,
        height: Math.round(header.height * 1000) / 1000,
      },
    }));
  const ready = async () => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect
      .poll(async () => {
        try {
          return await page.evaluate(
            () => window.__layoutProbe.capture().pages.length,
          );
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(1);
    return page.evaluate(() => window.__layoutProbe.pages());
  };
  for (const [scale, zoom] of [
    [1, 1],
    [0.5, 0.5],
    [1.5, 3],
  ]) {
    await page.evaluate(
      ({ content, scale, zoom }) => {
        window.__layoutProbe.scale(scale);
        window.__layoutProbe.zoom(zoom);
        window.__layoutProbe.pageSize({ width: 600, height: 280, margin: 20 });
        window.__layoutProbe.document({ type: "doc", content });
      },
      { content, scale, zoom },
    );
    const pages = await ready();
    if (!baselinePages) baselinePages = pages;
    else
      expect(pageMap(pages), "zoom must not repaginate a document").toEqual(
        pageMap(baselinePages),
      );
    expect(pages.filter((page) => page.header).length).toBe(pages.length - 1);
    const geometry = await page.evaluate(() => {
      const root = document.querySelector(
        '[role="textbox"][aria-label="Text editor"]',
      );
      const canvas = root.closest(".flow-canvas");
      const origin = canvas.getBoundingClientRect();
      const scale = origin.width / 600;
      const rows = [...root.querySelectorAll("tr")].filter(
        (row) => !row.classList.contains("pagination-spacer"),
      );
      return rows.map((row) => {
        const rect = row.getBoundingClientRect();
        const top = (rect.top - origin.top) / scale - 20;
        return {
          text: row.innerText,
          top: top % 308,
          bottom: (top % 308) + rect.height / scale,
        };
      });
    });
    for (const row of geometry) {
      expect(row.bottom, row.text).toBeLessThanOrEqual(240.6);
      expect(row.top, row.text).toBeGreaterThanOrEqual(-0.6);
    }
    const printed = await page.evaluate(() => window.__layoutProbe.capture());
    expect(
      (printed.html.match(/class="repeated-table-header"/g) || []).length,
    ).toBe(pages.length - 1);
    report.checks.push({
      scale,
      zoom,
      pages: pages.length,
      headers: pages.filter((page) => page.header).length,
    });
  }
  await page.evaluate(() => {
    window.__layoutProbe.scale(1);
    window.__layoutProbe.zoom(1);
    const from = window.__layoutProbe.text().indexOf("ROW12");
    window.__layoutProbe.edit(
      from,
      from + 5,
      "A changed cell with more words that wraps across several visual lines.",
    );
  });
  const incremental = await ready();
  await page.evaluate(() => window.__layoutProbe.fullLayout());
  expect(await ready()).toEqual(incremental);
  report.checks.push(
    "header page map agrees after incremental and complete layout",
  );
  // Whole vertical merges move as one row group; header cannot strand above it.
  const merged = [
    paragraph("Before"),
    {
      type: "table",
      content: [
        row([cell("Heading", true), cell("Value", true)]),
        ...Array.from({ length: 8 }, (_, i) => [
          row([cell(`MERGE${i}`, false, { rowspan: 2 }), cell(`FIRST${i}`)]),
          row([cell(`SECOND${i}`)]),
        ]).flat(),
      ],
    },
  ];
  await page.evaluate(
    (content) => window.__layoutProbe.document({ type: "doc", content }),
    merged,
  );
  await ready();
  for (let i = 0; i < 8; i++) {
    const same = await page.evaluate(
      (i) =>
        window.__layoutProbe.page(`MERGE${i}`) ===
        window.__layoutProbe.page(`SECOND${i}`),
      i,
    );
    expect(same).toBe(true);
  }
  report.checks.push("vertical merge groups remain together");
  await page.screenshot({ path: path.join(directory, "table.png") });
  const publication = await page.evaluate(() => window.__layoutProbe.capture());
  fs.writeFileSync(path.join(directory, "pages.html"), publication.html);
  const pdf = await app.evaluate(
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
    },
    path.join(directory, "pages.html"),
  );
  fs.writeFileSync(path.join(directory, "pages.pdf"), Buffer.from(pdf));
  const filler = paragraph("START");
  filler.content = Array.from({ length: 8 }, (_, i) => [
    ...(i ? [{ type: "hard_break" }] : []),
    { type: "text", text: `LINE${i}` },
  ]).flat();
  await page.evaluate(
    (content) => window.__layoutProbe.document({ type: "doc", content }),
    [
      filler,
      {
        type: "table",
        content: [
          row([cell("ORPHAN_HEADER", true), cell("Value", true)]),
          row([cell("FIRST_BODY"), cell("Text")]),
        ],
      },
    ],
  );
  await ready();
  expect(
    await page.evaluate(() => [
      window.__layoutProbe.page("ORPHAN_HEADER"),
      window.__layoutProbe.page("FIRST_BODY"),
    ]),
  ).toEqual([1, 1]);
  report.checks.push("header stays with first body row at a page boundary");
  const oversized = cell("LONG_START");
  oversized.content[0].content = Array.from({ length: 30 }, (_, i) => [
    ...(i ? [{ type: "hard_break" }] : []),
    { type: "text", text: `LONG${i}` },
  ]).flat();
  await page.evaluate(
    (content) => window.__layoutProbe.document({ type: "doc", content }),
    [
      {
        type: "table",
        content: [
          row([cell("Head", true), cell("Value", true)]),
          row([oversized, cell("Side")]),
        ],
      },
    ],
  );
  await ready();
  expect(await page.evaluate(() => window.__layoutProbe.text())).toContain(
    "LONG29",
  );
  report.checks.push(
    "oversized row remains editable through line splitting fallback",
  );
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
