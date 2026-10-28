import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopExecutable } from "./desktop-paths.mjs";

const directory = path.resolve("work/layout-prototype");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-layout-"));
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const report = {
  status: "running",
  cases: [],
  limitations: [
    "Prototype only: mixed sections, wrapped anchors, footnotes and tagged PDF are not implemented. Repeated headers are covered separately by test-table-pagination-desktop.mjs.",
  ],
};
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
  for (const [scale, zoom] of [
    [1, 1],
    [0.5, 0.5],
    [1.5, 3],
  ]) {
    await page.evaluate(
      ({ scale, zoom }) => {
        window.__layoutProbe.scale(scale);
        window.__layoutProbe.zoom(zoom);
      },
      { scale, zoom },
    );
    let result;
    await expect
      .poll(async () => {
        try {
          result = await page.evaluate(() => window.__layoutProbe.capture());
          return result.pages.length;
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(1);
    // Wait for zoom/scale effects to settle before comparing the authoritative map.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    result = await page.evaluate(() => window.__layoutProbe.capture());
    const label = `scale-${scale}-zoom-${zoom}`;
    fs.writeFileSync(path.join(directory, `${label}.html`), result.html);
    const printed = await app.evaluate(
      async ({ BrowserWindow }, { file }) => {
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
            "document.fonts.ready.then(() => true)",
          );
          const differences = await w.webContents
            .executeJavaScript(`Array.from(document.querySelectorAll('[data-publication-top]'), node => {
            const range = document.createRange(); range.selectNodeContents(node);
            const rect = Array.from(range.getClientRects()).find(rect => rect.width > 0);
            const origin = node.closest('.publication-sheet').getBoundingClientRect();
            return { text: node.textContent.slice(0, 35), dy: rect.top - origin.top - Number(node.dataset.publicationTop), dx: rect.left - origin.left - Number(node.dataset.publicationLeft) };
          }).filter(item => Math.abs(item.dy) > 0.75 || Math.abs(item.dx) > 0.75)`);
          return {
            differences,
            pdf: [
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
      { file: path.join(directory, `${label}.html`) },
    );
    fs.writeFileSync(
      path.join(directory, `${label}.pdf`),
      Buffer.from(printed.pdf),
    );
    report.cases.push({
      label,
      pages: result.pages,
      milliseconds: result.milliseconds,
      differences: printed.differences,
    });
  }
  report.flow = [];
  const paragraph = (lines, attrs = {}) => ({
    type: "paragraph",
    attrs: {
      lineSpacingMode: "exact",
      lineSpacing: 18,
      spaceAfter: 0,
      spaceBefore: 0,
      widowOrphan: false,
      ...attrs,
    },
    content: lines.flatMap((text, index) => [
      ...(index ? [{ type: "hard_break" }] : []),
      { type: "text", text },
    ]),
  });
  const filler = (count) =>
    Array.from({ length: count }, (_, i) => paragraph([`Filler ${i}`]));
  for (const spec of [
    {
      name: "keep together",
      content: [
        ...filler(7),
        paragraph(["FLOW_START", "FLOW_END"], { keepTogether: true }),
      ],
      expected: [1, 1],
    },
    {
      name: "keep with next",
      content: [
        ...filler(7),
        paragraph(["FLOW_START"], { keepWithNext: true }),
        paragraph(["FLOW_END"]),
      ],
      expected: [1, 1],
    },
    {
      name: "widow control",
      content: [
        ...filler(5),
        paragraph(["FLOW_START", "Second line", "FLOW_END", "Last line"], {
          widowOrphan: true,
        }),
      ],
      expected: [0, 1],
    },
    {
      name: "orphan control",
      content: [
        ...filler(7),
        paragraph(["FLOW_START", "Middle line", "FLOW_END"], {
          widowOrphan: true,
        }),
      ],
      expected: [1, 1],
    },
    {
      name: "page break before",
      content: [
        paragraph(["FLOW_START"]),
        paragraph(["FLOW_END"], { pageBreakBefore: true }),
      ],
      expected: [0, 1],
    },
    {
      name: "no leading blank page",
      content: [
        paragraph(["FLOW_START", "FLOW_END"], { pageBreakBefore: true }),
      ],
      expected: [0, 0],
    },
    {
      name: "oversized kept paragraph still splits",
      content: [
        paragraph(
          [
            "FLOW_START",
            ...Array.from({ length: 20 }, () => "Oversized line"),
            "FLOW_END",
          ],
          { keepTogether: true, widowOrphan: true },
        ),
      ],
      expected: [0, 2],
    },
  ]) {
    await page.evaluate((content) => {
      window.__layoutProbe.scale(1);
      window.__layoutProbe.zoom(1);
      window.__layoutProbe.pageSize({ width: 600, height: 240, margin: 20 });
      window.__layoutProbe.document({ type: "doc", content });
    }, spec.content);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect
      .poll(async () => {
        try {
          await page.evaluate(() => window.__layoutProbe.capture());
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
    const actual = await page.evaluate(() => [
      window.__layoutProbe.page("FLOW_START"),
      window.__layoutProbe.page("FLOW_END"),
    ]);
    report.flow.push({ name: spec.name, expected: spec.expected, actual });
    expect(actual, spec.name).toEqual(spec.expected);
  }
  const roundTrip = await page.evaluate(() =>
    window.__layoutProbe.clipboardRoundTrip({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            lineSpacingMode: "atLeast",
            lineSpacing: 19.5,
            keepWithNext: false,
            keepTogether: true,
            widowOrphan: false,
            pageBreakBefore: true,
          },
          content: [{ type: "text", text: "Clipboard flow" }],
        },
      ],
    }),
  );
  expect(roundTrip[0].attrs).toMatchObject({
    lineSpacingMode: "atLeast",
    lineSpacing: 19.5,
    keepWithNext: false,
    keepTogether: true,
    widowOrphan: false,
    pageBreakBefore: true,
  });
  report.flow.push({
    name: "clipboard retains flow without invalid numbers",
    passed: true,
  });
  for (const [mode, expected] of [
    ["exact", 24],
    ["atLeast", 57.6],
  ]) {
    await page.evaluate(
      (mode) =>
        window.__layoutProbe.document({
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { lineSpacingMode: mode, lineSpacing: 18 },
              content: [
                {
                  type: "text",
                  text: "Large first line",
                  marks: [{ type: "text_style", attrs: { fontSize: 36 } }],
                },
                { type: "hard_break" },
                {
                  type: "text",
                  text: "Large second line",
                  marks: [{ type: "text_style", attrs: { fontSize: 36 } }],
                },
              ],
            },
          ],
        }),
      mode,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const metrics = await page.evaluate(() => {
      const root = document.querySelector('[aria-label="Text editor"]');
      const spans = root.querySelectorAll('span[style*="font-size"]');
      const scale = root.getBoundingClientRect().width / 560;
      return {
        pitch:
          (spans[1].getBoundingClientRect().top -
            spans[0].getBoundingClientRect().top) /
          scale,
        scale,
        parentLeading: getComputedStyle(root.firstElementChild).lineHeight,
        spanLeading: getComputedStyle(spans[0]).lineHeight,
        font: getComputedStyle(spans[0]).fontSize,
      };
    });
    const { pitch } = metrics;
    report.flow.push({
      name: `${mode} leading with large inline text`,
      ...metrics,
    });
    if (mode === "exact" && Math.abs(pitch - expected) >= 0.2)
      report.limitations.push(
        `Exact leading with mixed inline font sizes still expands from ${expected} to ${pitch.toFixed(2)} CSS px in browser line boxes; not qualified for release as exact mixed-font layout.`,
      );
    else expect(Math.abs(pitch - expected)).toBeLessThan(0.2);
  }
  report.reflow = [];
  const layoutReady = async () => {
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
    return page.evaluate(() => ({
      pages: window.__layoutProbe.pages(),
      geometry: Array.from(
        document.querySelector('[aria-label="Text editor"]').children,
        (node) => {
          const r = node.getBoundingClientRect();
          const origin = node.parentElement.getBoundingClientRect();
          return [r.top - origin.top, r.height];
        },
      ),
    }));
  };
  const reflowDocument = {
    type: "doc",
    content: Array.from({ length: 100 }, (_, index) =>
      paragraph(
        [
          `BLOCK${index} ` +
            "A measured paragraph keeps its identity while words change. ".repeat(
              8,
            ),
        ],
        {
          blockId: `flow-${index}`,
          keepWithNext: index % 9 === 0,
          widowOrphan: true,
        },
      ),
    ),
  };
  await page.evaluate((doc) => {
    window.__layoutProbe.pageSize({ width: 600, height: 720, margin: 40 });
    window.__layoutProbe.document(doc);
  }, reflowDocument);
  await layoutReady();
  for (const spec of [
    {
      name: "insert at start",
      marker: "BLOCK0",
      count: 0,
      text: "New words ".repeat(80),
    },
    {
      name: "delete across page boundaries",
      marker: "BLOCK22",
      count: 900,
      text: "",
    },
    {
      name: "same-length edit near end",
      marker: "BLOCK92",
      count: 5,
      text: "OTHER",
    },
    {
      name: "insert in middle",
      marker: "BLOCK50",
      count: 0,
      text: "Added ".repeat(300),
    },
  ]) {
    const started = performance.now();
    await page.evaluate((spec) => {
      const start = window.__layoutProbe.text().indexOf(spec.marker);
      if (start < 0) throw Error("Missing edit marker");
      window.__layoutProbe.edit(start, start + spec.count, spec.text);
    }, spec);
    const incremental = await layoutReady();
    const milliseconds = performance.now() - started;
    await page.evaluate(() => window.__layoutProbe.fullLayout());
    const full = await layoutReady();
    expect(incremental.pages, spec.name).toEqual(full.pages);
    expect(incremental.geometry.length).toBe(full.geometry.length);
    const largestDifference = Math.max(
      ...incremental.geometry.flatMap((r, i) =>
        r.map((value, at) => Math.abs(value - full.geometry[i][at])),
      ),
    );
    expect(largestDifference, spec.name).toBeLessThan(0.5);
    report.reflow.push({
      name: spec.name,
      pages: full.pages.length,
      milliseconds,
      largestDifference,
    });
  }
  report.status = "captured";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
