import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/paragraph-appearance");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-paragraph-"));
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
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Chapter text editor", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  const content = [];
  for (let i = 0; i < 100; i++) {
    if (i) content.push({ type: "hard_break" });
    content.push({
      type: "text",
      text: `PAINT${String(i).padStart(4, "0")} A shaded line.`,
    });
  }
  const attrs = {
    paragraphBackground: "#eeddcc",
    paragraphBorderColor: "#123456",
    paragraphBorderWidth: 1.5,
    paragraphPadding: 6,
    lineSpacingMode: "exact",
    lineSpacing: 18,
    widowOrphan: false,
  };
  const doc = { type: "doc", content: [{ type: "paragraph", attrs, content }] };
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
      .toBeGreaterThan(2);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    const result = await page.evaluate(() => {
      const p = document.querySelector(
          '.ProseMirror[aria-label="Text editor"] p',
        ),
        style = getComputedStyle(p),
        probe = window.__layoutProbe;
      return {
        pages: probe.pages().map((p) => ({ from: p.from, to: p.to })),
        clip: style.clipPath,
        background: style.backgroundColor,
        border: style.outlineWidth,
        doc: probe.doc(),
        snapshot: probe.snapshots()[0],
        clipboard: probe.clipboardRoundTrip(probe.doc()),
      };
    });
    expect(result.background).toBe("rgb(238, 221, 204)");
    expect(parseFloat(result.border)).toBeGreaterThan(0);
    expect(result.clip).toContain("path(");
    expect(result.snapshot).toContain("clip-path");
    expect(JSON.stringify(result.doc)).not.toContain("clip-path");
    expect(result.clipboard[0].attrs.paragraphPadding).toBe(6);
    baseline ??= result.pages;
    expect(result.pages).toEqual(baseline);
    report.checks.push({ scale, zoom, pages: result.pages.length });
  }
  await page.evaluate(() => {
    window.__layoutProbe.scale(1);
    window.__layoutProbe.zoom(1);
  });
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
  await page.screenshot({ path: path.join(directory, "page.png") });
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
    path.join(directory, "paragraph.pdf"),
    Buffer.from(pdf, "base64"),
  );
  const editor = page.getByRole("textbox", {
    name: "Text editor",
    exact: true,
  });
  await editor.focus();
  await page.keyboard.press("Control+Home");
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Paragraph…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Paragraph", exact: true });
  await dialog
    .getByLabel("Paragraph border width (pt)", { exact: true })
    .fill("3");
  await dialog.getByLabel("Paragraph padding (pt)", { exact: true }).fill("8");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__layoutProbe.doc().content[0].attrs.paragraphBorderWidth,
      ),
    )
    .toBe(3);
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__layoutProbe.doc().content[0].attrs.paragraphBorderWidth,
      ),
    )
    .toBe(1.5);
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" End");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .toContain(" End");
  await page.keyboard.press("Control+z");
  await page.evaluate(() =>
    window.__layoutProbe.document({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { paragraphBackground: "#eeddcc", paragraphBorderWidth: 1.5 },
          content: [{ type: "text", text: "Short" }],
        },
      ],
    }),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector('.ProseMirror[aria-label="Text editor"] p'),
          ).clipPath,
      ),
    )
    .toBe("none");
  report.checks.push(
    "clipboard, full/incremental agreement, dialog apply and undo, typing, removal of stale clipping",
  );
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
