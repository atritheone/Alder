import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build, Platform } from "electron-builder";
import { createRequire } from "node:module";
import { platformBuilderConfig } from "./platform-builder-config.mjs";
const args = process.argv.slice(2);
const requested = args.includes("--mac")
  ? "darwin"
  : args.includes("--linux")
    ? "linux"
    : process.platform;
if (requested !== process.platform)
  throw new Error(
    "Build inside the target OS using its native resource bundle.",
  );
if (requested !== "win32") {
  // Offline runtimes are large; /tmp may be a small RAM-backed filesystem.
  const packagingTemp = path.resolve(process.env.ALDER_PACKAGE_TMP_DIR || "work/package-tmp");
  fs.mkdirSync(packagingTemp, { recursive: true });
  process.env.TMPDIR = packagingTemp;
  process.env.APP_BUILDER_TMP_DIR = packagingTemp;
}
const resources = path.resolve(
  process.env.ALDER_RESOURCES_DIR || "work/bundle-resources",
);
if (requested !== "win32") {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(resources, "platform-manifest.json"), "utf8"),
  );
  if (
    !manifest.complete ||
    manifest.platform !== process.platform ||
    manifest.architecture !== process.arch
  )
    throw new Error(
      "Prepare a complete resource bundle for this OS and architecture before packaging.",
    );
}
const check = spawnSync(process.execPath, ["scripts/verify-resources.mjs"], {
  stdio: "inherit",
  env: { ...process.env, ALDER_RESOURCES_DIR: resources },
});
if (check.status !== 0) process.exit(check.status || 1);
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
// Inline config arrays are appended to package.json's arrays by electron-builder.
// Load one explicit configuration file instead, so resources are copied once.
const configPath = path.resolve("work/desktop-builder-config.json");
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({
  ...platformBuilderConfig(pkg, requested),
  extraResources: pkg.build.extraResources.map((entry) =>
    entry.from === "work/bundle-resources"
      ? { ...entry, from: resources }
      : entry,
  ),
}, null, 2));
const platform =
  requested === "darwin"
    ? Platform.MAC
    : requested === "linux"
      ? Platform.LINUX
      : Platform.WINDOWS;
await build({
  targets: platform.createTarget(
    requested === "win32" || args.includes("--dir") ? ["dir"] : undefined,
  ),
  publish: "never",
  config: configPath,
});
if (requested === "win32") {
  const require = createRequire(import.meta.url);
  const { editWindowsResources } = require("app-builder-lib/out/util/resEdit");
  await editWindowsResources({
    file: path.resolve(pkg.build.directories.output, "win-unpacked/Alder.exe"),
    iconPath: path.resolve(pkg.build.win.icon),
    fileVersion: pkg.version,
    productVersion: pkg.version,
    versionStrings: {
      ProductName: "Alder",
      FileDescription: pkg.alderSetup.descriptions.win32,
      InternalName: "Alder",
      OriginalFilename: "Alder.exe",
      CompanyName: pkg.author.name,
      LegalCopyright: pkg.build.copyright,
    },
  });
}
