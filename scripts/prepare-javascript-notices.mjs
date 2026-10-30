import fs from "node:fs";
import path from "node:path";

// Preserve notices for libraries compiled into Alder's UI. This runs on the
// build machine, so the release never needs npm or a network connection.
const root = process.cwd();
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
const output = path.join(
  process.env.ALDER_RESOURCES_DIR || path.join(root, "work/bundle-resources"),
  "notices/javascript",
);
fs.mkdirSync(output, { recursive: true });
const records = [];
const notices = [];
for (const [relative, entry] of Object.entries(lock.packages)) {
  if (!relative.startsWith("node_modules/") || entry.dev) continue;
  const folder = path.join(root, relative);
  if (!fs.existsSync(path.join(folder, "package.json"))) continue;
  const metadata = JSON.parse(
    fs.readFileSync(path.join(folder, "package.json"), "utf8"),
  );
  const files = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter(
      (item) =>
        item.isFile() &&
        /^(licen[cs]e|copying|notice|copyright)(\.|$)/i.test(item.name),
    );
  records.push({
    name: metadata.name,
    version: metadata.version,
    license:
      metadata.name === "citeproc"
        ? "CPAL-1.0 (selected licence option)"
        : metadata.license || entry.license || "See package notices",
    noticeFiles: files.map((file) => file.name),
  });
  for (const file of files)
    notices.push(
      `${metadata.name} ${metadata.version} — ${file.name}\n\n${fs.readFileSync(path.join(folder, file.name), "utf8")}`,
    );
}
// CPAL source availability and complete citation style/locale attribution are
// retained beside the minified UI, so an offline installation has both.
const citations = path.join(output, "citations");
fs.mkdirSync(citations, { recursive: true });
for (const name of [
  "citeproc_commonjs.js",
  "LICENSE",
  "README.rst",
  "package.json",
])
  fs.copyFileSync(
    path.join(root, "node_modules/citeproc", name),
    path.join(citations, name),
  );
for (const name of [
  "README.md",
  "CPAL-1.0.txt",
  "CC-BY-SA-3.0.txt",
  "apa.csl",
  "ieee.csl",
  "locales-en-US.xml",
])
  fs.copyFileSync(
    path.join(root, "frontend/src/citationAssets", name),
    path.join(citations, name),
  );
fs.writeFileSync(
  path.join(output, "inventory.json"),
  JSON.stringify(records, null, 2) + "\n",
);
const equationFonts = path.join(output, "equation-fonts");
fs.mkdirSync(equationFonts, {recursive:true});
for(const name of ["OFL.txt","provenance.json"])
  fs.copyFileSync(path.join(root,"frontend/src/equationAssets",name),path.join(equationFonts,name));
fs.writeFileSync(
  path.join(output, "LICENSES.txt"),
  notices.join("\n\n" + "=".repeat(72) + "\n\n") + "\n",
);
console.log(
  `Preserved JavaScript license metadata for ${records.length} production packages.`,
);
