// Alternating matched native sequences, never simultaneous timing workloads.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    output: { type: "string" },
    baseline: { type: "string" },
    runs: { type: "string", default: "10" },
  },
});
const output = path.resolve(
  values.output || fs.mkdtempSync(path.join(os.tmpdir(), "alder-paired-")),
);
fs.mkdirSync(output, { recursive: true });
const run = (command, args, cwd) => {
  const r = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32" && command === "npm",
  });
  if (r.status !== 0) throw Error(`${command} failed (${r.status})`);
};
let baseline = values.baseline;
if (!baseline) {
  baseline = path.join(output, "baseline");
  fs.mkdirSync(baseline, { recursive: true });
  const archive = path.join(output, "baseline.tar");
  run("git", ["archive", "7226aea", "--output", archive]);
  run("tar", ["-xf", archive, "-C", baseline]);
  fs.symlinkSync(
    path.resolve("node_modules"),
    path.join(baseline, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  run("npm", ["run", "build"], baseline);
}
const repetitions = Number(values.runs);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10)
  throw Error("Choose 1–10 runs.");
const report = {
  baselineRevision: "7226aea",
  platform: process.platform,
  architecture: process.arch,
  runs: [],
  status: "running",
};
const save = () =>
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
try {
  for (let round = 0; round < repetitions; round++)
    for (const label of round % 2
      ? ["candidate", "baseline"]
      : ["baseline", "candidate"]) {
      const directory = path.join(output, `${label}-${round}`);
      run(process.execPath, [
        "scripts/developer/benchmark-operations.mjs",
        "--root",
        label === "baseline" ? baseline : ".",
        "--output",
        directory,
      ]);
      report.runs.push({
        round,
        label,
        ...JSON.parse(
          fs.readFileSync(path.join(directory, "report.json"), "utf8"),
        ),
      });
      save();
    }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  save();
}
