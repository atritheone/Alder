import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
if (process.platform !== "win32") process.exit(0);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-menu-repaint-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "New", exact: true }).waitFor();
  const hwnd = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (process.env.ALDER_MENU_INTERACTIVE === "1") {
      w.show();
      w.focus();
    } else {
      w.showInactive();
    }
    return w.getNativeWindowHandle().readBigUInt64LE().toString();
  });
  const probe = (action, ...args) =>
    execFileSync(
      path.join(process.env.ALDER_RESOURCES_DIR, "python/python.exe"),
      ["scripts/windows-menu-probe.py", hwnd, action, ...args.map(String)],
      { encoding: "utf8", windowsHide: true },
    );
  const check = async (color) => {
    await expect
      .poll(() => JSON.parse(probe("surface")).flat())
      .toEqual(Array(9).fill(color));
  };
  const inspect = () => JSON.parse(probe("inspect"));
  for (const workspace of [false, true]) {
    if (workspace) {
      await page.getByRole("button", { name: "New", exact: true }).click();
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Chapter text editor", exact: true })
        .waitFor();
    }
    const color = workspace ? 0xc6c6c6 : 0xe6e6e6;
    await check(color);
    if (process.env.ALDER_MENU_INTERACTIVE === "1") {
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.show();
        w.focus();
      });
      for (const letter of ["f", "e", "v"]) {
        probe("open", letter);
        await expect.poll(() => inspect().flags & 4).toBe(4);
        probe("close");
        await expect.poll(() => inspect().flags & 4).toBe(0);
        await check(color);
      }
    }
    for (let i = 0; i < 3; i++) {
      probe("redraw-menu");
      probe("redraw-frame");
      await check(color);
    }
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].maximize(),
    );
    await check(color);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].unmaximize(),
    );
    await check(color);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1100, 800),
    );
    await check(color);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.hide();
      w.showInactive();
    });
    await check(color);
    probe("notify", "0x31a");
    await check(color); // WM_THEMECHANGED
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setFullScreen(true),
    );
    await expect.poll(() => inspect().menu.length).toBe(0);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setFullScreen(false),
    );
    await expect.poll(() => inspect().menu.length).toBeGreaterThan(0);
    await check(color);
  }
  const result = JSON.stringify({
    ok: true,
    livePixelRead: true,
    start: true,
    workspace: true,
    resize: true,
    maximiseRestore: true,
    showHide: true,
    theme: true,
    fullscreen: true,
    menuDismissal: process.env.ALDER_MENU_INTERACTIVE === "1",
  });
  fs.writeFileSync(path.resolve("work/menu-repaint-result.json"), result);
  console.log(result);
} finally {
  await app.close();
}
