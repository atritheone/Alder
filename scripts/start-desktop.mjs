import { spawn } from "node:child_process";
import path from "node:path";
import { desktopExecutable } from "./desktop-paths.mjs";
const executable = path.resolve(
  process.platform === "win32"
    ? "node_modules/electron/dist/Alder.exe"
    : desktopExecutable(),
);
const child = spawn(executable, [".", ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
