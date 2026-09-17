import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";

// Source testing is deliberately separate from setup and packaged releases.
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkoutId = createHash("sha256")
  .update(source.toLowerCase())
  .digest("hex")
  .slice(0, 12);
const workspace = path.join(
  process.env.LOCALAPPDATA || "",
  "AlderTesting",
  checkoutId,
);
const buildOnly = process.argv.includes("--build-only");
const directories = [
  "frontend",
  "electron",
  "backend",
  "scripts",
  "build",
  "resources",
  "chatterbox/src",
];
const files = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "requirements.txt",
  "LICENCE.md",
];
const excluded = new Set([
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  "test-results",
]);
const exists = async (file) => Boolean(await fs.stat(file).catch(() => null));

async function sourceFiles() {
  const result = [...files];
  async function visit(relative) {
    for (const entry of await fs.readdir(path.join(source, relative), {
      withFileTypes: true,
    })) {
      if (excluded.has(entry.name) || /\.py[co]$/.test(entry.name)) continue;
      if (entry.isSymbolicLink())
        throw new Error(
          `Source links are not supported: ${relative}/${entry.name}`,
        );
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) result.push(name);
    }
  }
  for (const directory of directories) await visit(directory);
  return result.sort();
}

async function fingerprint(list) {
  const hash = createHash("sha256");
  for (const file of list)
    hash.update(file).update(await fs.readFile(path.join(source, file)));
  return hash.digest("hex");
}

async function removeGenerated(relative) {
  const target = path.resolve(workspace, relative);
  const resolved = await fs.realpath(target).catch(() => target);
  if (!resolved.startsWith(workspace + path.sep))
    throw new Error(
      `Refusing to remove outside the testing workspace: ${resolved}`,
    );
  await fs.rm(target, { recursive: true, force: true });
}

async function run(executable, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workspace,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Build command failed (exit ${code}). No older build will be launched.`,
            ),
          ),
    );
  });
}

async function resourcesDirectory() {
  const candidates = process.env.ALDER_RESOURCES_DIR
    ? [path.resolve(process.env.ALDER_RESOURCES_DIR)]
    : [
        path.join(source, "release/win-unpacked/resources"),
        path.join(source, "work/bundle-resources"),
        ...[
          process.env.ALDER_SETUP_HOME,
          path.join(process.env.LOCALAPPDATA, "AlderSetup"),
          path.join(process.env.LOCALAPPDATA, "AlderSetup-validation"),
        ]
          .filter(Boolean)
          .map((root) => path.join(root, "resources/win32-x64")),
      ];
  for (const candidate of candidates) {
    if (
      (await exists(path.join(candidate, "python/python.exe"))) &&
      (await exists(path.join(candidate, "speech/python/python.exe")))
    )
      return candidate;
  }
  throw new Error(
    "No bundled Alder runtimes found. Run setup.ps1 install, or set ALDER_RESOURCES_DIR to a complete Alder resources directory.",
  );
}

async function closeRunningAlder() {
  // WM_CLOSE uses Alder's save handshake. Never force-kill a user's app.
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `
    $ErrorActionPreference = 'Stop'
    $session = (Get-Process -Id $PID).SessionId
    $apps = @(Get-CimInstance Win32_Process -Filter "Name = 'Alder.exe'" | Where-Object { $_.SessionId -eq $session -and $_.CommandLine -notmatch '\\s--type=' })
    foreach ($record in $apps) {
      $appProcess = Get-Process -Id $record.ProcessId -ErrorAction SilentlyContinue
      if (-not $appProcess) { continue }
      if (-not $appProcess.CloseMainWindow()) { throw 'Close Alder before running start.cmd again.' }
      if (-not $appProcess.WaitForExit(30000)) { throw 'Alder is still saving or needs attention. Close it before running start.cmd again.' }
    }
  `,
    ],
    { stdio: "inherit", windowsHide: true },
  );
}

async function main() {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA)
    throw new Error("This testing launcher requires Windows.");
  const resources = await resourcesDirectory();
  const npm = path.join(
    path.dirname(process.execPath),
    "node_modules/npm/bin/npm-cli.js",
  );
  if (!(await exists(npm)))
    throw new Error("Source testing requires Node.js with npm on PATH.");
  await fs.mkdir(workspace, { recursive: true });
  const marker = path.join(workspace, ".alder-testing.json");
  if (await exists(marker)) {
    if (JSON.parse(await fs.readFile(marker, "utf8")).source !== source)
      throw new Error("Testing workspace belongs to another checkout.");
  } else {
    if ((await fs.readdir(workspace)).length)
      throw new Error("Testing workspace contains unowned files.");
    await fs.writeFile(marker, JSON.stringify({ source }));
  }
  const lockPath = path.join(workspace, ".launcher.lock");
  if (await exists(lockPath)) {
    const pid = Number(await fs.readFile(lockPath, "utf8"));
    let running = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") running = false;
    }
    if (running)
      throw new Error(
        "Another testing build is still running. Wait for it to finish.",
      );
    await removeGenerated(".launcher.lock");
  }
  const lock = await fs.open(lockPath, "wx");
  await lock.writeFile(String(process.pid));
  try {
    if (!buildOnly) await closeRunningAlder();
    const inputs = await sourceFiles();
    const revision = await fingerprint(inputs);
    console.log(
      `Building current checkout: ${source}\nTesting workspace: ${workspace}`,
    );
    for (const directory of directories) await removeGenerated(directory);
    for (const file of inputs) {
      const destination = path.join(workspace, file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.join(source, file), destination);
    }
    const env = { ...process.env, ALDER_RESOURCES_DIR: resources };
    delete env.ELECTRON_RUN_AS_NODE;
    const dependencies = createHash("sha256")
      .update(await fs.readFile(path.join(workspace, "package.json")))
      .update(await fs.readFile(path.join(workspace, "package-lock.json")))
      .digest("hex");
    const dependencyStamp = path.join(workspace, ".dependencies.sha256");
    if (
      (await fs.readFile(dependencyStamp, "utf8").catch(() => "")) !==
        dependencies ||
      !(await exists(path.join(workspace, "node_modules/typescript/bin/tsc")))
    ) {
      await fs.rm(dependencyStamp, { force: true });
      await run(process.execPath, [npm, "ci", "--no-audit", "--no-fund"], env);
      await fs.writeFile(dependencyStamp, dependencies);
    }
    await run(process.execPath, [npm, "run", "build"], env);
    if ((await fingerprint(await sourceFiles())) !== revision)
      throw new Error(
        "The checkout changed during the build. Run start.cmd again to build those edits; the older snapshot was not launched.",
      );
    const executable = path.join(
      workspace,
      "node_modules/electron/dist/Alder.exe",
    );
    await fs.writeFile(
      path.join(workspace, "last-build.json"),
      JSON.stringify(
        {
          source,
          revision,
          executable,
          resources,
          builtAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    if (buildOnly) return;
    const child = spawn(executable, [workspace, ...process.argv.slice(2)], {
      cwd: workspace,
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    console.log("Launched the newly built Alder testing app.");
  } finally {
    await lock.close();
    await fs.rm(lockPath, { force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
