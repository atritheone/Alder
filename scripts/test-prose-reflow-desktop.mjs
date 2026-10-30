// Incremental prose must equal a fresh layout after growth, shrinkage and undo.
import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopExecutable } from "./desktop-paths.mjs";
const directory = path.resolve("work/prose-reflow"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-prose-reflow-"));
fs.mkdirSync(directory, { recursive: true });
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const report = { status: "running", checks: [], errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1400, 1000);
    w.show();
    w.focus();
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  const editor = page.getByRole("textbox", {
    name: "Text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  const settle = async () => {
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
    return page.evaluate(() =>
      window.__layoutProbe
        .pages()
        .map((p) => ({ from: p.from, to: p.to, text: p.text, frame: p.frame })),
    );
  };
  await page.evaluate(() => {
    const p = window.__layoutProbe;
    p.pageSize({ width: 500, height: 600, margin: 40 });
    p.document({
      type: "doc",
      content: Array.from({ length: 240 }, (_, i) => ({
        type: "paragraph",
        attrs: {
          blockId: `p${i}`,
          hyphenation: true,
          spaceAfter: 0,
          spaceBefore: 0,
          lineSpacingMode: "exact",
          lineSpacing: 18,
        },
        content: [
          {
            type: "text",
            text:
              `PAR${i} ` +
              "Extraordinary paragraphs retain their identities and exact wording. ".repeat(
                7,
              ),
            ...(i % 3 ? {} : { marks: [{ type: "em" }] }),
          },
          ...(i % 7
            ? []
            : [
                { type: "hard_break" },
                { type: "text", text: "A final line." },
              ]),
        ],
      })),
    });
  });
  await expect
    .poll(() => page.locator(".discretionary-hyphen").count())
    .toBeGreaterThan(100);
  await settle();
  const sameAsFresh = async (label) => {
    const incremental = await settle();
    await page.evaluate(() => window.__layoutProbe.fullLayout());
    const fresh = await settle();
    expect(incremental).toEqual(fresh);
    report.checks.push({ label, pages: fresh.length });
  };
  await page.evaluate(() => {
    window.__retainedPageWidgets = [
      ...document.querySelectorAll(".pagination-spacer"),
    ].slice(-25);
    window.__layoutProbe.edit(4, 4, "x");
  });
  await settle();
  report.retainedTail = await page.evaluate(
    () =>
      window.__retainedPageWidgets.filter((node) => node.isConnected).length,
  );
  expect(report.retainedTail).toBe(25);
  await sameAsFresh("Single-character edit retains distant page widgets");
  for (const [label, start, length, insert] of [
    [
      "Growing first paragraph",
      0,
      0,
      "A long addition with more lines. ".repeat(100),
    ],
    ["Deleting across paragraphs", 0.35, 0.15, "Short replacement. "],
    [
      "Growing near the end",
      0.9,
      0,
      "More text for a continuing paragraph. ".repeat(60),
    ],
    ["Paragraph split", 0.55, 0, "\n"],
  ]) {
    const before = await page.evaluate(() => window.__layoutProbe.text());
    const beforeMap = await settle();
    if (insert === "\n") {
      await page.evaluate((start) => {
        const p = window.__layoutProbe,
          at = Math.floor(p.text().length * start);
        p.select(at, at);
      }, start);
      await editor.press("Enter");
    } else
      await page.evaluate(
        ({ start, length, insert }) => {
          const p = window.__layoutProbe,
            n = p.text().length,
            at = Math.floor(n * start);
          p.edit(at, Math.min(n, at + Math.floor(n * length)), insert);
        },
        { start, length, insert },
      );
    const changed = await settle();
    await editor.press("Control+z");
    const undone = await settle();
    expect(await page.evaluate(() => window.__layoutProbe.text())).toBe(before);
    expect(undone).toEqual(beforeMap);
    await editor.press("Control+Shift+z");
    expect(await settle()).toEqual(changed);
    await sameAsFresh(label + " with undo/redo");
  }
  await page.screenshot({ path: path.join(directory, "prose.png") });
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
