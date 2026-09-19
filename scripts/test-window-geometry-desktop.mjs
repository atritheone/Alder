import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
if (process.platform !== "win32") process.exit(0);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-geometry-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
const results = [];
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "New", exact: true }).waitFor();
  const hwnd = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.show();
    w.focus();
    return w.getNativeWindowHandle().readBigUInt64LE().toString();
  });
  const inspect = () =>
    JSON.parse(
      execFileSync(
        path.join(process.env.ALDER_RESOURCES_DIR, "python/python.exe"),
        ["scripts/windows-menu-probe.py", hwnd, "inspect"],
        { encoding: "utf8", windowsHide: true },
      ),
    );
  const snap = async (phase) => {
    const win = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return {
        bounds: w.getBounds(),
        content: w.getContentBounds(),
        scale: screen.getDisplayMatching(w.getBounds()).scaleFactor,
      };
    });
    const dom = await page.evaluate(() => ({
      inner: [innerWidth, innerHeight],
      outer: [outerWidth, outerHeight],
      screen: [screenX, screenY],
      dpr: devicePixelRatio,
      start: document
        .querySelector(".start-screen")
        ?.getBoundingClientRect()
        .toJSON(),
      form: document
        .querySelector(".new-document")
        ?.getBoundingClientRect()
        .toJSON(),
    }));
    const native = inspect();
    expect(
      Math.abs(dom.inner[0] * dom.dpr - native.client[2]),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(dom.inner[1] * dom.dpr - native.client[3]),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(win.content.x * win.scale - native.client[0]),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(win.content.y * win.scale - native.client[1]),
    ).toBeLessThanOrEqual(2);
    expect(dom.start.right).toBeCloseTo(dom.inner[0], 0);
    expect(dom.start.bottom).toBeGreaterThanOrEqual(dom.inner[1] - 1);
    if (dom.form) {
      expect(dom.form.top).toBeGreaterThanOrEqual(75);
      expect(dom.inner[1] - dom.form.bottom).toBeGreaterThanOrEqual(75);
    }
    results.push({ phase, win, dom, native });
    fs.writeFileSync(
      "work/geometry-result.json",
      JSON.stringify(results, null, 2),
    );
    await page.screenshot({ path: `work/geometry-${phase}.png` });
  };
  await snap("start");
  await page.evaluate(() =>
    document.addEventListener("pointerdown", (e) => {
      window.lastNativePointer = { x: e.clientX, y: e.clientY };
    }),
  );
  const nativeClick = async (locator) => {
    const rect = await locator.boundingBox();
    const dpr = await page.evaluate(() => devicePixelRatio);
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    await page.evaluate(() => {
      window.lastNativePointer = null;
    });
    execFileSync(
      path.join(process.env.ALDER_RESOURCES_DIR, "python/python.exe"),
      [
        "scripts/windows-menu-probe.py",
        hwnd,
        "client-click",
        String(Math.round(x * dpr)),
        String(Math.round(y * dpr)),
      ],
      { encoding: "utf8", windowsHide: true },
    );
    await expect
      .poll(() => page.evaluate(() => window.lastNativePointer))
      .not.toBeNull();
    const pointer = await page.evaluate(() => window.lastNativePointer);
    expect(Math.abs(pointer.x - x)).toBeLessThan(2);
    expect(Math.abs(pointer.y - y)).toBeLessThan(2);
  };
  await nativeClick(page.getByRole("button", { name: "New", exact: true }));
  await page.getByRole("dialog", { name: "New document" }).waitFor();
  await snap("new");
  await nativeClick(page.getByRole("button", { name: "Cancel", exact: true }));
  await expect(page.getByRole("dialog", { name: "New document" })).toHaveCount(
    0,
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(700, 600),
  );
  await nativeClick(page.getByRole("button", { name: "New", exact: true }));
  await page.getByRole("dialog", { name: "New document" }).waitFor();
  await nativeClick(
    page.getByRole("button", { name: "Book Chapters & pages", exact: true }),
  );
  await expect
    .poll(() => page.evaluate(() => innerHeight))
    .toBeGreaterThan(700);
  await expect(async () => snap("book")).toPass({ timeout: 3000 });
  await nativeClick(
    page.getByRole("button", { name: "Text document .txt", exact: true }),
  );
  await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(470);
  await expect(async () => snap("text")).toPass({ timeout: 3000 });
  await nativeClick(page.getByRole("button", { name: "Create", exact: true }));
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .waitFor();
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    )
    .toBe(true);
  await nativeClick(
    page.getByRole("button", { name: "Toggle sandbox", exact: true }),
  );
  await expect(
    page.getByRole("textbox", { name: "Sandbox text editor", exact: true }),
  ).toBeVisible();
  fs.writeFileSync(
    "work/geometry-pass.json",
    JSON.stringify({
      ok: true,
      visibleStartup: true,
      nativeClicks: true,
      viewportMatchesClient: true,
      formPadding: true,
      bookResizing: true,
      workspaceClicks: true,
    }),
  );
} catch (e) {
  fs.writeFileSync("work/geometry-error.txt", String(e.stack));
  throw e;
} finally {
  await app.close();
}
