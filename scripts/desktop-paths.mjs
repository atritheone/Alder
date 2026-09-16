import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export function desktopExecutable(packaged = false) {
  if (process.env.ALDER_DESKTOP_EXECUTABLE)
    return path.resolve(process.env.ALDER_DESKTOP_EXECUTABLE);
  if (!packaged) return require("electron");
  return path.resolve(
    process.platform === "win32"
      ? "release/win-unpacked/Alder.exe"
      : process.platform === "darwin"
        ? `release/mac${process.arch === "arm64" ? "-arm64" : ""}/Alder.app/Contents/MacOS/Alder`
        : "release/linux-unpacked/alder",
  );
}
