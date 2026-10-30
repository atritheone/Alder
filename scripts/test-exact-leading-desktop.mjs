import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/exact-leading");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-exact-"));
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
  report.errors = [];
  page.on("pageerror", (error) => report.errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  for (const [font, size, scale, zoom] of [
    ["Cambria", 36, 1, 1],
    ["Arial", 72, 1, 1],
    ["Times New Roman", 60, 0.5, 0.5],
    ["Cambria", 72, 1.5, 3],
  ]) {
    const content = [];
    for (let line = 0; line < 4; line++) {
      if (line) content.push({ type: "hard_break" });
      content.push(
        {
          type: "text",
          text: `Big ${line}`,
          marks: [
            { type: "strong" },
            { type: "em" },
            { type: "text_style", attrs: { fontFamily: font, fontSize: size } },
          ],
        },
        { type: "text", text: ` small${line}` },
        { type: "text", text: "sub", marks: [{ type: "subscript" }] },
        { type: "text", text: "sup", marks: [{ type: "superscript" }] },
      );
    }
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { lineSpacingMode: "exact", lineSpacing: 18 },
          content,
        },
      ],
    };
    await page.evaluate(
      ({ doc, scale, zoom }) => {
        window.__layoutProbe.scale(scale);
        window.__layoutProbe.zoom(zoom);
        window.__layoutProbe.document(doc);
        window.__layoutProbe.capturePages(true);
      },
      { doc, scale, zoom },
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
      .toBeGreaterThan(0);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    const measured = await page.evaluate(() => {
      const p = document.querySelector(".flow-canvas .ProseMirror p"),
        rect = p.getBoundingClientRect(),
        scale = rect.width / p.offsetWidth;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT),
        lines = [];
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (!n.textContent.includes(" small")) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        lines.push((r.getBoundingClientRect().top - rect.top) / scale);
      }
      return {
        height: rect.height / scale,
        lines,
        text: window.__layoutProbe.text(),
        snapshot: window.__layoutProbe.snapshots()[0],
      };
    });
    report.checks.push({
      font,
      size,
      scale,
      zoom,
      ...measured,
      snapshot: undefined,
    });
    expect(measured.height).toBeCloseTo(96, 0);
    expect(measured.lines).toHaveLength(4);
    for (let i = 1; i < 4; i++)
      expect(measured.lines[i] - measured.lines[i - 1]).toBeCloseTo(24, 0);
    expect(measured.snapshot).toContain("line-height: 0px");
  }
  await page.evaluate(() => {
    window.__layoutProbe.scale(1);
    window.__layoutProbe.zoom(1);
  });
  const editor = page.getByRole("textbox", {
    name: "Text editor",
    exact: true,
  });
  await editor.focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" typed");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .toContain(" typed");
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .not.toContain(" typed");
  const target = await page.evaluate(() => {
    const p = document.querySelector(".flow-canvas .ProseMirror p"),
      walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.textContent === " small2") {
        const range = document.createRange();
        range.setStart(n, 4);
        range.setEnd(n, 5);
        const r = range.getBoundingClientRect();
        return { x: r.left + 0.1, y: r.top + r.height / 2 };
      }
    }
  });
  await page.mouse.click(target.x, target.y);
  await page.keyboard.type("X");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text().split("\n")[2]))
    .toContain("X");
  await page.keyboard.press("Control+z");
  await page.evaluate(() =>
    window.__layoutProbe.document({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            lineSpacingMode: "exact",
            lineSpacing: 18,
            tabStops: [{ position: 216, align: "right", leader: "dot" }],
          },
          content: [
            {
              type: "text",
              text: "Big",
              marks: [{ type: "text_style", attrs: { fontSize: 36 } }],
            },
            { type: "text", text: "\t12.34" },
            { type: "hard_break" },
            { type: "text", text: "Next\t45.67" },
          ],
        },
      ],
    }),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const p = document.querySelector(".flow-canvas .ProseMirror p");
        return (
          p.getBoundingClientRect().height /
          (p.getBoundingClientRect().width / p.offsetWidth)
        );
      }),
    )
    .toBeCloseTo(48, 0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector(".flow-canvas .alder-tab"),
            "::after",
          ).backgroundImage,
      ),
    )
    .toContain("gradient");
  await page.screenshot({ path: path.join(directory, "exact.png") });
  // Unmarked exact-leading paragraphs need no run wrappers. Compare their
  // real glyph/caret geometry with equivalent underlined runs using the full
  // compensation path, including a font much taller than its exact leading.
  for (const size of [12, 36]) {
    const content = Array.from({ length: 40 }, (_, i) => ({
      type: "paragraph",
      attrs: {
        fontSize: size,
        lineSpacingMode: "exact",
        lineSpacing: 18,
        spaceBefore: 0,
        spaceAfter: 0,
      },
      content: [
        {
          type: "text",
          text: `PLAIN${i} measured words continue along the line.`,
        },
      ],
    }));
    await page.evaluate(
      (content) => window.__layoutProbe.document({ type: "doc", content }),
      content,
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
      .toBeGreaterThan(0);
    const geometry = () =>
      page.evaluate(() => ({
        pages: window.__layoutProbe
          .pages()
          .map((p) => ({ from: p.from, to: p.to })),
        height: document
          .querySelector(".flow-canvas .ProseMirror")
          .getBoundingClientRect().height,
      }));
    const plain = await geometry();
    content.forEach((p) => (p.content[0].marks = [{ type: "underline" }]));
    await page.evaluate(
      (content) => window.__layoutProbe.document({ type: "doc", content }),
      content,
    );
    await expect
      .poll(async () => {
        try {
          return (await geometry()).pages;
        } catch {
          return [];
        }
      })
      .toEqual(plain.pages);
    expect((await geometry()).height).toBeCloseTo(plain.height, 0);
  }
  const long = [];
  for (let i = 0; i < 100; i++) {
    if (i) long.push({ type: "hard_break" });
    long.push(
      {
        type: "text",
        text: `BIG${i}`,
        marks: [{ type: "text_style", attrs: { fontSize: 36 } }],
      },
      { type: "text", text: ` small${i}` },
    );
  }
  await page.evaluate(
    (content) =>
      window.__layoutProbe.document({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { lineSpacingMode: "exact", lineSpacing: 18 },
            content,
          },
        ],
      }),
    long,
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
    .toBeGreaterThan(2);
  const before = await page.evaluate(() => window.__layoutProbe.pages());
  await page.evaluate(() => window.__layoutProbe.fullLayout());
  await expect
    .poll(() =>
      page.evaluate(() => {
        try {
          return window.__layoutProbe.pages();
        } catch {
          return [];
        }
      }),
    )
    .toEqual(before);
  const publication = await page.evaluate(() => window.__layoutProbe.capture());
  const pdf = await app.evaluate(async ({ BrowserWindow }, { html }) => {
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
  }, publication);
  fs.writeFileSync(
    path.join(directory, "exact.pdf"),
    Buffer.from(pdf, "base64"),
  );
  report.pages = before.length;
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
