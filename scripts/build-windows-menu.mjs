import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);

// Build alongside the Electron bundle; source testing copies electron/ into its external workspace.
export function buildWindowsMenu() {
  if (process.platform !== "win32") return;
  const source = path.resolve("electron/native/windows-menu");
  const version = require("electron/package.json").version;
  const bundledPython = path.join(
    process.env.ALDER_RESOURCES_DIR || "work/bundle-resources",
    "python/python.exe",
  );
  const python =
    process.env.PYTHON ||
    (fs.existsSync(bundledPython) ? bundledPython : undefined);
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("node-gyp/bin/node-gyp.js"),
      "rebuild",
      ...(python ? [`--python=${python}`] : []),
      `--target=${version}`,
      `--arch=${process.arch}`,
      "--dist-url=https://electronjs.org/headers",
      `--directory=${source}`,
    ],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.status !== 0)
    throw new Error(
      "Windows menus could not be compiled. Install Visual Studio Build Tools with Desktop development with C++ and a Windows SDK.",
    );
  fs.mkdirSync("dist-electron", { recursive: true });
  fs.copyFileSync(
    path.join(source, "build/Release/alder_windows_menu.node"),
    "dist-electron/alder_windows_menu.node",
  );
}
