import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/section-layout");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-sections-"));
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
  const para = (text) => ({
    type: "paragraph",
    attrs: { spaceAfter: 0, spaceBefore: 0 },
    content: [{ type: "text", text }],
  });
  const content = [
    para("FIRST_MARKER"),
    {
      type: "section_break",
      attrs: {
        kind: "oddPage",
        page: {
          pageSize: "A4",
          orientation: "landscape",
          marginTopMm: 15,
          marginBottomMm: 17,
          marginLeftMm: 19,
          marginRightMm: 21,
        },
      },
    },
    para(
      "SECOND_MARKER " +
        "The next section has its own width and margins. ".repeat(28),
    ),
    {
      type: "section_break",
      attrs: {
        kind: "nextPage",
        page: { pageSize: "A5", orientation: "portrait", marginMm: 20 },
      },
    },
    para("THIRD_MARKER"),
  ];
  const ready = async (minimum = 3) => {
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
      .toBeGreaterThanOrEqual(minimum);
    return page.evaluate(() => window.__layoutProbe.pages());
  };
  let baseline;
  for (const [scale, zoom] of [
    [1, 1],
    [0.5, 0.5],
    [1.5, 3],
  ]) {
    await page.evaluate(
      ({ content, scale, zoom }) => {
        const p = window.__layoutProbe;
        p.scale(scale);
        p.zoom(zoom);
        p.capturePages(true);
        p.document({ type: "doc", content });
      },
      { content, scale, zoom },
    );
    const pages = await ready();
    const map = pages.map(({ frame, ...p }) => ({
      ...p,
      frame: frame && {
        top: frame.top,
        left: frame.left,
        width: frame.layout.width,
        height: frame.layout.height,
      },
    }));
    if (baseline) expect(map).toEqual(baseline);
    else baseline = map;
    expect(pages[1].text).toBe("");
    expect(pages[2].text).toContain("SECOND_MARKER");
    expect(pages.at(-1).text).toContain("THIRD_MARKER");
    const geometry = await page.evaluate(() => {
      const p = window.__layoutProbe,
        canvas = document.querySelector(".flow-canvas").getBoundingClientRect(),
        factor =
          canvas.width /
          parseFloat(document.querySelector(".flow-canvas").style.width);
      const result = [];
      for (const marker of ["FIRST_MARKER", "SECOND_MARKER", "THIRD_MARKER"]) {
        const node = [
          ...document.querySelectorAll(".flow-canvas .ProseMirror p"),
        ].find((p) => p.textContent.startsWith(marker));
        const frame = p.pages()[p.page(marker)].frame,
          r = node.getBoundingClientRect();
        result.push({
          marker,
          left: (r.left - canvas.left) / factor - frame.left,
          width: r.width / factor,
          top: (r.top - canvas.top) / factor - frame.top,
          expected: frame.layout.margins || {
            left: frame.layout.margin,
            top: frame.layout.margin,
            right: frame.layout.margin,
          },
          pageWidth: frame.layout.width,
        });
      }
      return result;
    });
    for (const g of geometry) {
      expect(g.left).toBeCloseTo(g.expected.left, 1);
      expect(g.width).toBeCloseTo(
        g.pageWidth - g.expected.left - g.expected.right,
        1,
      );
      expect(g.top).toBeGreaterThanOrEqual(g.expected.top - 0.5);
    }
    const snapshots = await page.evaluate(() =>
      window.__layoutProbe.snapshots(),
    );
    expect(snapshots).toHaveLength(pages.length);
    const copyBounds = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html"),
        p = doc.querySelector("p");
      return {
        left: parseFloat(p.style.left),
        width: parseFloat(p.style.width),
      };
    }, snapshots[0]);
    expect(copyBounds.left).toBeCloseTo((20 * 96) / 25.4, 1);
    expect(copyBounds.width).toBeCloseTo((170 * 96) / 25.4, 1);
    expect(snapshots[2]).toContain(`--page-width: ${297 * (96 / 25.4)}px`);
    report.checks.push({ scale, zoom, pages: pages.length, geometry });
  }
  await page.evaluate(() => {
    const p = window.__layoutProbe;
    p.scale(1);
    p.zoom(1);
    p.navigate(p.page("THIRD_MARKER"));
  });
  await ready();
  const paragraph = page
    .locator(".flow-canvas .ProseMirror p")
    .filter({ hasText: "THIRD_MARKER" });
  await paragraph.click({ position: { x: 25, y: 12 } });
  await page.keyboard.press("End");
  await page.keyboard.type(" typed");
  await expect(paragraph).toContainText("typed");
  await page.keyboard.press("Control+z");
  await expect(paragraph).toHaveText("THIRD_MARKER");
  await ready();
  report.checks.push("scaled later-section caret and undo");
  // The real controls preserve selection, create a writable section, and undo once.
  await page.getByRole("button", { name: "More formatting" }).click();
  await page.getByRole("menuitem", { name: /^Section properties/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Section", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Section orientation", { exact: true })
    .selectOption("landscape");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await ready();
  expect(
    (await page.evaluate(() => window.__layoutProbe.pages())).at(-1).frame
      .layout.width,
  ).toBeGreaterThan(700);
  await page.keyboard.press("Control+z");
  await ready();
  expect(
    (await page.evaluate(() => window.__layoutProbe.pages())).at(-1).frame
      .layout.width,
  ).toBeLessThan(600);
  await paragraph.click({ position: { x: 25, y: 12 } });
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "More formatting" }).click();
  await page.getByRole("menuitem", { name: /^Insert section break/ }).click();
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await ready();
  await page.keyboard.type("NEW_SECTION_TEXT");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .toContain("NEW_SECTION_TEXT");
  expect(
    (await page.evaluate(() => window.__layoutProbe.doc())).content.filter(
      (n) => n.type === "section_break",
    ),
  ).toHaveLength(3);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await ready();
  expect(
    (await page.evaluate(() => window.__layoutProbe.doc())).content.filter(
      (n) => n.type === "section_break",
    ),
  ).toHaveLength(2);
  report.checks.push(
    "edit section, insert at document end, type, undo, preserve boundaries",
  );
  const incremental = await ready();
  await page.evaluate(() => window.__layoutProbe.fullLayout());
  expect(await ready()).toEqual(incremental);
  report.checks.push("incremental section layout matches a full layout");
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
  report.pages = publication.pages;
  await page.screenshot({ path: path.join(directory, "sections.png") });
  const numberedPage = {
    width: (210 * 96) / 25.4,
    height: (297 * 96) / 25.4,
    margin: (20 * 96) / 25.4,
    header: "RUNNING_HEADER",
    footer: true,
    firstPageNumber: 8,
  };
  await page.evaluate(
    ({ content, settings }) => {
      window.__layoutProbe.document({ type: "doc", content });
      window.__layoutProbe.pageSize(settings);
    },
    { content, settings: numberedPage },
  );
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
    .toBe(3);
  const numbered = await ready();
  expect(numbered[1].text).toContain("SECOND_MARKER");
  await expect(
    page.locator(".page-sheet").nth(1).locator(".page-furniture"),
  ).toContainText("9");
  await page.evaluate((settings) => window.__layoutProbe.pageSize(settings), {
    ...numberedPage,
    firstPageNumber: 1,
  });
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
    .toBe(4);
  await ready();
  await expect(
    page.locator(".page-sheet").nth(1).locator(".page-furniture"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__layoutProbe.snapshots()[1]),
  ).not.toContain("page-furniture");
  report.checks.push(
    "odd sections follow configured page numbering, and parity blanks have no running furniture",
  );
  await page.evaluate((settings) => window.__layoutProbe.pageSize(settings), {
    ...numberedPage,
    header: "",
    footer: false,
    firstPageNumber: 1,
  });
  // Repeated headers on a narrower section must use that page's coordinate origin.
  const table = {
    type: "table",
    content: Array.from({ length: 32 }, (_, i) => ({
      type: "table_row",
      content: [
        {
          type: i ? "table_cell" : "table_header",
          content: [para(i ? `CELL${i}` : "SECTION_HEADER")],
        },
      ],
    })),
  };
  await page.evaluate(
    (content) => window.__layoutProbe.document({ type: "doc", content }),
    [
      para("TABLE_PRELUDE"),
      {
        type: "section_break",
        attrs: {
          kind: "nextPage",
          page: {
            pageSize: "Custom",
            pageWidthMm: 120,
            pageHeightMm: 100,
            marginMm: 10,
          },
        },
      },
      table,
    ],
  );
  const tablePages = await ready();
  expect(tablePages.filter((p) => p.header).length).toBeGreaterThan(1);
  const headerGeometry = await page
    .locator(".page-sheet .repeated-table-header")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        left: parseFloat(n.style.left),
        width: parseFloat(n.style.width),
      })),
    );
  for (const g of headerGeometry) {
    expect(g.left).toBeCloseTo((10 * 96) / 25.4, 0);
    expect(g.width).toBeLessThan((120 * 96) / 25.4);
  }
  await page.evaluate(() => {
    const p = window.__layoutProbe,
      offset = p.text().indexOf("CELL12");
    p.edit(offset, offset + 6, "A changed cell that wraps. ".repeat(12));
  });
  const changed = await ready();
  await page.evaluate(() => window.__layoutProbe.fullLayout());
  const rounded = (pages) =>
    JSON.parse(
      JSON.stringify(pages, (_key, value) =>
        typeof value === "number" ? Math.round(value * 100) / 100 : value,
      ),
    );
  expect(rounded(await ready())).toEqual(rounded(changed));
  report.checks.push(
    "repeated table headers align within a narrower section; incremental and full layout agree",
  );
  await page.evaluate(
    (content) => window.__layoutProbe.document({ type: "doc", content }),
    [
      para("BEFORE_SECTION"),
      {
        type: "section_break",
        attrs: {
          blockId: "reorder-section",
          kind: "oddPage",
          page: { pageSize: "A5", orientation: "landscape", marginMm: 15 },
        },
      },
      para("MOVE_LATER"),
      { type: "page_break" },
      para("MOVE_EARLIER"),
    ],
  );
  const reorderMap = await ready();
  expect(reorderMap).toHaveLength(4);
  const reorderBefore = await page.evaluate(() => window.__layoutProbe.doc());
  await page.evaluate(() => window.__layoutProbe.movePage(3, 2));
  const reorderAfter = await ready();
  expect(reorderAfter[2].text).toContain("MOVE_EARLIER");
  expect(reorderAfter[3].text).toContain("MOVE_LATER");
  expect(reorderAfter.map((p) => p.frame.layout)).toEqual(
    reorderMap.map((p) => p.frame.layout),
  );
  const moved = await page.evaluate(() => window.__layoutProbe.doc());
  expect(moved.content.find((n) => n.type === "section_break")).toEqual(
    reorderBefore.content.find((n) => n.type === "section_break"),
  );
  await page.getByRole("button", { name: "Undo last change", exact: true }).click();
  await ready();
  expect(await page.evaluate(() => window.__layoutProbe.doc())).toEqual(
    reorderBefore,
  );
  // Explicit restarts use logical parity and remain anchored when earlier text
  // gains pages. Reused suffix frames must never keep an obsolete offset.
  await page.evaluate((para) => {
    const p = window.__layoutProbe;
    p.scale(1);
    p.zoom(1);
    p.pageSize({
      width: 794,
      height: 1123,
      margin: 76,
      footer: true,
      firstPageNumber: 28,
      pageNumberFormat: "upperLetter",
    });
    p.document({
      type: "doc",
      content: [
        para,
        {
          type: "section_break",
          attrs: {
            kind: "oddPage",
            page: {},
            numberingStart: 2,
            numberingFormat: "lowerRoman",
          },
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "RESTART_MARKER" }],
        },
        { type: "section_break", attrs: { kind: "nextPage", page: {} } },
        {
          type: "paragraph",
          content: [{ type: "text", text: "CONTINUE_MARKER" }],
        },
      ],
    });
  }, para("BEFORE_NUMBER_RESTART"));
  expect(await ready()).toHaveLength(3);
  const labels = () =>
    page.locator(".page-sheet .page-furniture").allTextContents();
  await expect.poll(labels).toEqual(["BB", "iii", "iv"]);
  const copiedNumbering = await page.evaluate(() =>
    window.__layoutProbe
      .clipboardRoundTrip(window.__layoutProbe.doc())
      .filter((node) => node.type === "section_break")
      .map((node) => node.attrs),
  );
  expect(copiedNumbering[0].numberingStart).toBe(2);
  expect(copiedNumbering[0].numberingFormat).toBe("lowerRoman");
  expect(copiedNumbering[1].numberingStart).toBeNull();
  expect(copiedNumbering[1].numberingFormat).toBeNull();
  await page.evaluate(() =>
    window.__layoutProbe.edit(
      0,
      0,
      "Earlier text grows into several pages. ".repeat(800),
    ),
  );
  const incremented = await ready(5);
  const marker = incremented.findIndex((p) =>
    p.text.includes("RESTART_MARKER"),
  );
  expect(marker + incremented[marker].frame.layout.pageNumberOffset).toBe(3);
  await expect
    .poll(async () => (await labels()).slice(-2))
    .toEqual(["iii", "iv"]);
  await page.evaluate(() => window.__layoutProbe.fullLayout());
  expect(await ready(5)).toEqual(incremented);
  report.checks.push(
    "Roman and alphabetic labels, parity restarts and continuation stay correct after incremental page-count changes",
  );
  // Returning to uniform pages must remove section CSS, and page spacing is
  // presentation only: no DOM mutation may feed back into authored text.
  await page.evaluate(
    (content) => window.__layoutProbe.document({ type: "doc", content }),
    [para("UNIFORM_AGAIN")],
  );
  await ready(1);
  expect(
    await page.evaluate(() =>
      window.__layoutProbe.doc().content.map((n) => n.type),
    ),
  ).toEqual(["paragraph"]);
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll("style[data-page-flow]")].every(
        (e) => !e.textContent,
      ),
    ),
  ).toBe(true);
  report.checks.push(
    "page moves retain section geometry, undo restores all content, and section CSS clears on uniform documents",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  report.dom = await page
    ?.evaluate(() => ({
      doc: window.__layoutProbe.doc(),
      pages: window.__layoutProbe.pages(),
      elements: [
        ...document.querySelectorAll(
          ".flow-canvas,.flow-canvas p,.editor-scroll",
        ),
      ].map((e) => ({
        tag: e.tagName,
        cls: e.className,
        style: e.getAttribute("style"),
        rect: e.getBoundingClientRect().toJSON(),
        scroll: [
          e.scrollTop,
          e.scrollLeft,
          e.scrollHeight,
          e.clientHeight,
          e.scrollWidth,
          e.clientWidth,
        ],
      })),
    }))
    .catch(() => null);
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
