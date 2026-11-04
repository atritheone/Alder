// Qualify the same editable page map and PDF at fractional monitor/UI scales.
import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/page-density-ui");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-page-density-"));
fs.mkdirSync(directory, { recursive: true });
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const report = { status: "running", cases: [], errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.unmaximize();
    w.setSize(1440, 1000);
    w.show();
    w.focus();
  });
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  const editor = page.getByRole("textbox", {
    name: "Text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  let baseline;
  for (const [density, scale, zoom] of [
    [1, 1, 1],
    [1.25, 0.5, 0.8],
    [1.5, 1.5, 3],
    [1.75, 1, 0.8],
    [2, 1, 0.8],
    [2, 1.5, 1],
    [1, 1, 1],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, density) =>
        BrowserWindow.getAllWindows()[0].webContents.enableDeviceEmulation({
          screenPosition: "desktop",
          screenSize: { width: 1440, height: 1000 },
          viewPosition: { x: 0, y: 0 },
          deviceScaleFactor: density,
          viewSize: { width: 1440 + Math.round(density * 10), height: 1000 },
          scale: 1,
        }),
      density,
    );
    await page.evaluate(
      ({ scale, zoom }) => {
        window.__layoutProbe.scale(scale);
        window.__layoutProbe.zoom(zoom);
      },
      { scale, zoom },
    );
    await expect
      .poll(() => page.evaluate(() => window.devicePixelRatio))
      .toBeCloseTo(density, 5);
    await expect
      .poll(() =>
        page
          .locator(".flow-canvas")
          .evaluate((e) => Number(getComputedStyle(e).zoom)),
      )
      .toBeCloseTo(1 / (density * scale), 4);
    let captured;
    await expect
      .poll(async () => {
        try {
          captured = await page.evaluate(() => window.__layoutProbe.capture());
          return captured.pages.length;
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(1);
    const map = captured.pages.map(({ from, to, fragments }) => ({
      from,
      to,
      fragments,
    }));
    baseline ??= map;
    expect(map).toEqual(baseline);
    const label = `${report.cases.length}-density-${density}-scale-${scale}-zoom-${zoom}`;
    const file = path.join(directory, label + ".html");
    fs.writeFileSync(file, captured.html);
    const pdf = await app.evaluate(async ({ BrowserWindow }, file) => {
      const renderer = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      try {
        await renderer.loadFile(file);
        await renderer.webContents.executeJavaScript(
          "document.fonts.ready.then(() => true)",
        );
        return [
          ...(await renderer.webContents.printToPDF({
            preferCSSPageSize: true,
            printBackground: true,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
          })),
        ];
      } finally {
        renderer.destroy();
      }
    }, file);
    fs.writeFileSync(path.join(directory, label + ".pdf"), Buffer.from(pdf));
    // Real typing at the end of a long paragraph must preserve its cursor and
    // return to the exact map after undo, including after changing monitors.
    await page.evaluate(() => {
      const at = window.__layoutProbe.text().indexOf("SPLIT0350");
      window.__layoutProbe.select(at, at);
    });
    await editor.press("x");
    await expect(editor).toContainText("xSPLIT0350");
    await editor.press("Control+z");
    await expect(editor).not.toContainText("xSPLIT0350");
    await expect
      .poll(async () => {
        try {
          return await page.evaluate(() =>
            window.__layoutProbe
              .capture()
              .pages.map(({ from, to, fragments }) => ({
                from,
                to,
                fragments,
              })),
          );
        } catch {
          return [];
        }
      })
      .toEqual(baseline);
    report.cases.push({
      density,
      scale,
      zoom,
      label,
      pages: captured.pages.map(({ html, ...p }) => p),
    });
  }
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  process.exitCode = 1;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
