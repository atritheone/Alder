import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/table-autofit");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-tabs-"));
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
const stage = (value) => {
  report.stage = value;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
};
try {
  stage("launch");
  app = await electron.launch({
    timeout: 10000,
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  stage("first window");
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(1800, 1200);
    w.setSize(1800, 1200);
    w.show();
    w.focus();
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Chapter text editor", exact: true }),
  ).toBeVisible();
  stage("load probe");
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );

  await page.evaluate(() => {
    document.querySelector('[style*="z-index: 999999"]').style.zIndex = "1";
  });

  for (const scale of [0.5, 1, 1.5]) {
    await page.evaluate((scale) => {
      const p = (text) => ({
        type: "paragraph",
        content: [{ type: "text", text }],
      });
      const c = (text, attrs = {}) => ({
        type: "table_cell",
        attrs,
        content: [p(text)],
      });
      window.__layoutProbe.scale(scale);
      window.__layoutProbe.zoom(1);
      window.__layoutProbe.document({
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "table_row",
                content: [c("Merged heading", { colspan: 2 }), c("Final")],
              },
              {
                type: "table_row",
                content: [
                  c("A"),
                  c("A substantially wider cell with several words"),
                  c("Medium"),
                ],
              },
            ],
          },
          p("After table"),
        ],
      });
    }, scale);
    const table = page.locator("[contenteditable=true] table").last();
    await table.getByText("A", { exact: true }).click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Fit columns to content", exact: true })
      .click();
    const widths = await page.evaluate(() =>
      window.__layoutProbe
        .doc()
        .content[0].content[1].content.map((c) => c.attrs.colwidth[0]),
    );
    expect(widths[1]).toBeGreaterThan(widths[0] * 2);
    expect(widths[2]).toBeGreaterThan(widths[0]);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThan(650);
    await page.keyboard.press("Control+z");
    expect(
      await page.evaluate(
        () =>
          window.__layoutProbe.doc().content[0].content[1].content[0].attrs
            .colwidth,
      ),
    ).toBeNull();
    await page.keyboard.press("Control+y");
    expect(
      await page.evaluate(() =>
        window.__layoutProbe
          .doc()
          .content[0].content[1].content.map((c) => c.attrs.colwidth[0]),
      ),
    ).toEqual(widths);
    expect(await table.innerText()).toContain("A substantially wider cell");
    report.checks.push({ scale, widths, undo: true, merged: true });
  }
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
