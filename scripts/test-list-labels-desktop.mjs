import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = path.resolve("work/list-labels"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-list-labels-"));
fs.mkdirSync(directory, { recursive: true });
const fixture = JSON.parse(
  fs.readFileSync("work/list-labels-word/fixture-project.json", "utf8"),
);
const expected = [
  "Z.",
  "AA.",
  "BB.",
  "yy.",
  "zz.",
  "aaa.",
  "MMMCMXCIX.",
  "MMMM.",
];
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const report = { status: "running", errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.setSize(1440,1000);window.show();window.focus();});
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  await page.evaluate(
    (doc) => window.__layoutProbe.document(doc),
    fixture.book.chapters[0].document,
  );
  const editor = page.getByRole("textbox", {
    name: "Text editor",
    exact: true,
  });
  await expect
    .poll(() =>
      editor
        .locator("li")
        .evaluateAll((nodes) =>
          nodes.map((node) =>
            getComputedStyle(node).listStyleType.replace(/^"|"$/g, "").trim(),
          ),
        ),
    )
    .toEqual(expected);
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
    path.join(directory, "labels.pdf"),
    Buffer.from(data, "base64"),
  );
  await page.screenshot({ path: path.join(directory, "labels.png") });
  expect(report.errors).toEqual([]);
  report.status = "passed";
  report.expected = expected;
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
