import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const packaged = process.argv.includes("--packaged");
const executable = path.resolve(
  packaged
    ? "release/win-unpacked/Alder.exe"
    : "node_modules/electron/dist/electron.exe",
);
const result = path.resolve(
  `work/${packaged ? "packaged" : "development"}-desktop-smoke.json`,
);
const data = path.resolve(
  `work/${packaged ? "packaged" : "development"}-desktop-data`,
);
const env = {
  ...process.env,
  ALDER_SMOKE_OUTPUT: result,
  ALDER_DATA_DIR: data,
  PATH: process.env.SystemRoot + "\\System32",
  PYTHONNOUSERSITE: "1",
};
delete env.PYTHONHOME;
delete env.PYTHONPATH;
delete env.ALDER_RESOURCES_DIR;
const args = packaged ? ["--smoke-test"] : [".", "--smoke-test"];
const child = spawn(executable, args, {
  env,
  windowsHide: true,
  stdio: "inherit",
});
const timeout = setTimeout(() => {
  child.kill();
  console.error("Desktop smoke timed out");
  process.exitCode = 1;
}, 60000);
child.on("exit", (code) => {
  clearTimeout(timeout);
  if (code !== 0 || !fs.existsSync(result)) {
    process.exitCode = 1;
    return;
  }
  const report = JSON.parse(fs.readFileSync(result, "utf8"));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
});
