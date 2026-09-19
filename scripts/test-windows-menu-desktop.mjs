import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
if (process.platform !== "win32") process.exit(0);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-winmenu-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const hwnd = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1280, 900);
    w.showInactive();
    return w.getNativeWindowHandle().readBigUInt64LE().toString();
  });
  const probe = (action, ...args) =>
    execFileSync(
      path.join(process.env.ALDER_RESOURCES_DIR, "python/python.exe"),
      ["scripts/windows-menu-probe.py", hwnd, action, ...args.map(String)],
      { encoding: "utf8", windowsHide: true },
    );
  const inspect = () => JSON.parse(probe("inspect"));
  const interactive = process.env.ALDER_MENU_INTERACTIVE === "1";
  await page.getByRole("button", { name: "New", exact: true }).waitFor();

  probe("capture", path.resolve("work/windows-menu-before.png"), "e6e6e6");
  const file = inspect().menu[0];
  expect(file.label).toBe("&File");
  expect(inspect().background).toBeTruthy();
  if (interactive) probe("open", "f");
  if (interactive) await expect.poll(() => inspect().flags & 4).toBe(4); // GUI_INMENUMODE
  probe("capture", path.resolve("work/windows-native-menu.png"));
  probe("close");
  probe("close");
  await expect.poll(() => inspect().flags & 4).toBe(0);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .waitFor();
  expect(inspect().background).toBeTruthy();
  const click = (item) => {
    probe("close");
    probe("command", item.id);
  };
  if (interactive) probe("open", "e");
  if (interactive) await expect.poll(() => inspect().flags & 4).toBe(4);
  const edit = inspect().menu.find((x) => x.label === "&Edit");
  const settingsItem = edit.children.find((x) =>
    x.label.startsWith("Settings"),
  );
  probe("capture", path.resolve("work/windows-edit-menu.png"), "c6c6c6");
  click(settingsItem);
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  await expect(
    page.getByRole("dialog", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  if (interactive) probe("open", "f");
  if (interactive) await expect.poll(() => inspect().flags & 4).toBe(4);
  probe("close");
  probe("close");
  await expect.poll(() => inspect().flags & 4).toBe(0);
  if (interactive) probe("open", "v");
  if (interactive) await expect.poll(() => inspect().flags & 4).toBe(4);
  probe("close");
  probe("close");
  await expect.poll(() => inspect().flags & 4).toBe(0);
  // Selecting an item updates the dynamic menu labels after the Windows loop exits.
  if (interactive) probe("open", "v");
  if (interactive) await expect.poll(() => inspect().flags & 4).toBe(4);
  const before = inspect().menu.find((x) => x.label === "&View").children[0];
  click(before);
  await expect
    .poll(
      () => inspect().menu.find((x) => x.label === "&View").children[0].label,
    )
    .not.toBe(before.label);
  // Role dispatch reaches Electron; fullscreen removes/restores HMENU.
  const fullscreen = inspect()
    .menu.find((x) => x.label === "&View")
    .children.find((x) => x.label.startsWith("Toggle Full Screen"));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.focus(),
  );
  if (interactive) await page.keyboard.press("F11");
  else probe("command", fullscreen.id);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isFullScreen(),
      ),
    )
    .toBe(true);
  await expect.poll(() => inspect().menu.length).toBe(0);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.focus(),
  );
  if (interactive) await page.keyboard.press("F11");
  else probe("command", fullscreen.id);
  await expect.poll(() => inspect().menu.length).toBeGreaterThan(0);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 720),
  );
  const geometry = inspect();
  expect(geometry.client[1]).toBeGreaterThanOrEqual(geometry.menu[0].rect[3]);
  // Exercise nested, disabled and radio items through the actual C++ API on a disposable window.
  const fixture = await app.evaluate(async ({ BrowserWindow }) => {
    const w = new BrowserWindow({ show: false, width: 500, height: 400 });
    w.setMenu(null);
    const { createRequire } = process.getBuiltinModule("module");
    const bridge = createRequire(process.cwd() + "/package.json")(
      "./dist-electron/alder_windows_menu.node",
    );
    bridge.set(w.getNativeWindowHandle(), [
      {
        id: 1,
        label: "&Test",
        children: [
          {
            id: 2,
            label: "Nested",
            children: [
              { id: 3, label: "Selected", checked: true, radio: true },
              { id: 4, label: "Unavailable", enabled: false },
            ],
          },
        ],
      },
    ]);
    globalThis.menuFixture = w;
    return w.getNativeWindowHandle().readBigUInt64LE().toString();
  });
  const fixtureState = JSON.parse(
    execFileSync(
      path.join(process.env.ALDER_RESOURCES_DIR, "python/python.exe"),
      ["scripts/windows-menu-probe.py", fixture, "inspect"],
      { encoding: "utf8", windowsHide: true },
    ),
  );
  expect(fixtureState.menu[0].children[0].children[0].state & 8).toBe(8);
  expect(fixtureState.menu[0].children[0].children[1].state & 3).not.toBe(0);
  await app.evaluate(() => globalThis.menuFixture.destroy());
  console.log(
    JSON.stringify({
      ok: true,
      nativeMenu: true,
      menuLoop: interactive,
      commands: true,
      shortcuts: true,
    }),
  );
} finally {
  await app.close();
}
