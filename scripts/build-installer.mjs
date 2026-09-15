import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const root = process.cwd();
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const appDir = path.resolve("release/win-unpacked");
const out = path.resolve(`release/Alder-${pkg.version}-Windows-x64`);
const scratch = path.resolve("work/installer-build");
await fs.mkdir(out, { recursive: true });
await fs.mkdir(scratch, { recursive: true });
const run = (exe, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${exe} exited ${code}`)),
    );
  });
const hash = async (file) => {
  const h = createHash("sha256");
  for await (const data of createReadStream(file)) h.update(data);
  return h.digest("hex");
};
const { editWindowsResources } = require("app-builder-lib/out/util/resEdit");
if (!process.argv.includes("--compile-only"))
  await editWindowsResources({
    file: path.join(appDir, "Alder.exe"),
    iconPath: path.resolve("build/alder.ico"),
    fileVersion: pkg.version,
    productVersion: pkg.version,
    versionStrings: {
      ProductName: "Alder",
      FileDescription: "Alder",
      InternalName: "Alder",
      OriginalFilename: "Alder.exe",
      CompanyName: "Alder",
      LegalCopyright: pkg.build.copyright,
    },
  });
let unpackedBytes = 0;
const files = [],
  dirs = [];
async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name),
      rel = path.relative(appDir, full);
    if (
      e.name === "__pycache__" ||
      /\.py[co]$/.test(e.name) ||
      rel.startsWith("resources\\backend\\tests")
    )
      continue;
    if (e.isDirectory()) {
      dirs.push(rel);
      await walk(full);
    } else {
      files.push(rel);
      unpackedBytes += (await fs.stat(full)).size;
    }
  }
}
await walk(appDir);
const seven = await require("app-builder-lib/out/toolsets/7zip").getPath7za();
const payload = `Alder-${pkg.version}-x64.7z`;
const payloadPath = path.join(out, payload);
const list = path.join(scratch, "payload-files.txt");
await fs.writeFile(list, files.join("\n"), "utf8");
if (!process.argv.includes("--compile-only")) {
  await fs.rm(payloadPath, { force: true });
  await run(
    seven,
    [
      "a",
      "-t7z",
      payloadPath,
      `@${list}`,
      "-scsUTF-8",
      "-mx=3",
      "-mmt=4",
      "-ms=64m",
      "-bsp0",
    ],
    { cwd: appDir },
  );
  await run(seven, ["t", payloadPath, "-bsp0"]);
}
const sum = await hash(payloadPath);
const tools = require("app-builder-lib/out/toolsets/windows");
const compiler = await tools.getMakeNsisPath();
const plugins = await tools.getNsisPluginsPath();
const escape = (s) => s.replaceAll("$", "$$").replaceAll('"', '$\\"');
const caches = files
  .filter((f) => f.endsWith(".py"))
  .map((f) =>
    path.join(path.dirname(f), "__pycache__", path.basename(f, ".py")),
  );
const uninstall = [
  ...caches.map((f) => `Delete "$INSTDIR\\${escape(f)}.*.pyc"`),
  ...[...new Set(caches.map((f) => path.dirname(f)))].map(
    (f) => `RMDir "$INSTDIR\\${escape(f)}"`,
  ),
  ...files.map((f) => `Delete "$INSTDIR\\${escape(f)}"`),
  ...dirs
    .sort((a, b) => b.length - a.length)
    .map((d) => `RMDir "$INSTDIR\\${escape(d)}"`),
];
await fs.writeFile(
  path.join(scratch, "uninstall-files.nsh"),
  uninstall.join("\n").replaceAll('"$INSTDIR', '"\\\\?\\$INSTDIR'),
);
const notice = await fs.readFile(
  path.join(path.dirname(path.dirname(seven)), "LICENSE.txt"),
  "utf8",
);
const lgpl = await fs.readFile(
  path.join(path.dirname(path.dirname(seven)), "COPYING"),
  "utf8",
);
await fs.writeFile(
  path.join(out, "Installer-Third-Party-Notices.txt"),
  `Installer components: NSIS (https://nsis.sourceforge.io/License), 7-Zip (https://www.7-zip.org/), and StdUtils (LGPL 2.1+, https://github.com/lordmulder/StdUtils). Source/build tool bundles: https://github.com/electron-userland/electron-builder-binaries .\n\n${notice}\n\n${lgpl}`,
);
const header = `!define INSTALL_SIZE_KB ${Math.ceil(unpackedBytes / 1024)}\n!define NOTICES "${escape(path.join(out, "Installer-Third-Party-Notices.txt"))}"\n!define VERSION "${pkg.version}"\n!define PAYLOAD "${payload}"\n!define PAYLOAD_HASH "${sum}"\n!define OUTPUT "${escape(path.join(out, `Alder-${pkg.version}-Setup.exe`))}"\n!define ICON "${escape(path.resolve("build/alder.ico"))}"\n!define SEVENZIP "${escape(seven)}"\n!define FILE_MANIFEST "${escape(path.join(scratch, "uninstall-files.nsh"))}"\n!addplugindir /x86-unicode "${escape(path.join(plugins, "x86-unicode"))}"\n!addincludedir "${escape(path.resolve("node_modules/app-builder-lib/templates/nsis/include"))}"\n!include "${escape(path.resolve("build/installer.nsi"))}"\n`;
const script = path.join(scratch, "installer.nsi");
await fs.writeFile(script, header);
await run(compiler.path, ["/V2", script], {
  env: { ...process.env, ...compiler.env },
});
const exe = `Alder-${pkg.version}-Setup.exe`;
await fs.writeFile(
  path.join(out, "SHA256SUMS.txt"),
  `${await hash(path.join(out, exe))}  ${exe}\n${sum}  ${payload}\n`,
);
await fs.writeFile(
  path.join(out, "README.txt"),
  `Alder ${pkg.version} for Windows x64\r\n\r\nKeep ${exe} and ${payload} together in the same folder.\r\nRun ${exe} to install. The installer verifies the data file before extraction.\r\nAll speech models, Python, dictionaries and publishing tools are included. No runtime download is needed.\r\nInstallation is for the current Windows user. Uninstall through Windows Settings > Apps.\r\nYour documents and Alder user data are preserved during uninstall.\r\nThis development installer is unsigned.\r\n`,
);
console.log(
  JSON.stringify({
    installer: path.join(out, exe),
    payload: payloadPath,
    sha256: sum,
    files: files.length,
  }),
);
