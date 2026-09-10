import fs from "node:fs";
import path from "node:path";

// Preserve notices for libraries compiled into Alder's UI. This runs on the
// build machine, so the release never needs npm or a network connection.
const root = process.cwd();
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);
const output = path.join(root, "work/bundle-resources/notices/javascript");
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
    license: metadata.license || entry.license || "See package notices",
    noticeFiles: files.map((file) => file.name),
  });
  for (const file of files)
    notices.push(
      `${metadata.name} ${metadata.version} — ${file.name}\n\n${fs.readFileSync(path.join(folder, file.name), "utf8")}`,
    );
}
fs.writeFileSync(
  path.join(output, "inventory.json"),
  JSON.stringify(records, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(output, "LICENSES.txt"),
  notices.join("\n\n" + "=".repeat(72) + "\n\n") + "\n",
);
console.log(
  `Preserved JavaScript license metadata for ${records.length} production packages.`,
);
