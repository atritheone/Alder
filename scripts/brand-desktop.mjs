import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Keep the dependency executable intact; launch a branded development copy.
export async function brandDesktop() {
  if (process.platform !== "win32") return;
  const directory = path.dirname(require.resolve("electron/package.json"));
  const source = path.join(directory, "dist/electron.exe");
  const target = path.join(directory, "dist/Alder.exe");
  const iconPath = path.resolve("build/alder.ico");
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  const stamp = createHash("sha256")
    .update(await fs.readFile(source))
    .update(await fs.readFile(iconPath))
    .update(pkg.version)
    .digest("hex");
  const stampPath = path.join(directory, "dist/alder-branding.sha256");
  if (
    (await fs.readFile(stampPath, "utf8").catch(() => "")) === stamp &&
    (await fs.stat(target).catch(() => null))
  )
    return;
  await fs.copyFile(source, target);
  const { editWindowsResources } = require("app-builder-lib/out/util/resEdit");
  await editWindowsResources({
    file: target,
    iconPath,
    fileVersion: pkg.version,
    productVersion: pkg.version,
    versionStrings: {
      ProductName: "Alder",
      FileDescription: "Alder · Organic Language Engine",
      InternalName: "Alder",
      OriginalFilename: "Alder.exe",
      CompanyName: "Alder",
      LegalCopyright: pkg.build.copyright,
    },
  });
  await fs.writeFile(stampPath, stamp);
  console.log("Applied Alder executable icon and product metadata.");
}
