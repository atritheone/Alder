import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = path.resolve(
  process.argv[2] || process.env.ALDER_RESOURCES_DIR || "work/bundle-resources",
);
const layout = JSON.parse(
  fs.readFileSync(
    new URL("../backend/alder/runtime-layout.json", import.meta.url),
    "utf8",
  ),
)[process.platform];
if (!layout) throw new Error(`Unsupported platform: ${process.platform}`);
const required = [
  ...Object.values(layout),
  "speech/chatterbox/src/chatterbox/tts_turbo.py",
  "speech/models/turbo/t3_turbo_v1.safetensors",
  "speech/models/turbo/s3gen_meanflow.safetensors",
  "speech/models/turbo/ve.safetensors",
  "fonts/LiberationSerif-Regular.ttf",
  "tools/tika/tika-app-3.3.2.jar",
  "proofreading/manifest.json",
  "proofreading/rules-inventory.json",
  "proofreading/languagetool/languagetool-server.jar",
];
const files = [];
function walk(p) {
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name);
    if (entry.isDirectory()) {
      if (!["__pycache__", ".git"].includes(entry.name)) walk(full);
    } else files.push(path.relative(root, full).replaceAll("\\", "/"));
  }
}
if (!fs.existsSync(root))
  throw new Error(
    "Prepare Alder resources before packaging. See docs/building.md.",
  );
walk(root);
const missing = required.filter((f) => !fs.existsSync(path.join(root, f)));
for (const [name, test] of [
  ["Calibre", /tools\/calibre\/.*ebook-convert(?:\.exe)?$/i],
  ["Java", /tools\/(java|jre)\/.*java(?:\.exe)?$/i],
  ["EPUBCheck", /tools\/epubcheck\/.*epubcheck\.jar$/i],
  ["WordNet", /nltk_data\/corpora\/wordnet(\.zip|\/)/i],
  ["QA model", /speech\/qa\/models\/.*model\.bin$/i],
])
  if (!files.some((f) => test.test(f))) missing.push(name);
if (missing.length)
  throw new Error("Incomplete self-contained resources: " + missing.join(", "));
const proofreading = JSON.parse(fs.readFileSync(path.join(root, "proofreading/manifest.json"), "utf8"));
if (proofreading.pythonBindings[`${process.platform}-${process.arch}`]) {
  for (const relative of [proofreading.model.file, process.platform === "win32" ? "python/python.exe" : "python/bin/python3"])
    if (!fs.existsSync(path.join(root, "proofreading", relative)))
      throw new Error(`Missing advanced proofreading resource: ${relative}`);
}
const tika = path.join(root, "tools/tika/tika-app-3.3.2.jar");
if (
  createHash("sha512").update(fs.readFileSync(tika)).digest("hex") !==
  "88c2032cba0d45feea361e6eebd2918bd04707614cdda5d89a1b167da5503c98e7b4cd368336f0402d559abcaf5006fcc7c825c32c749ae0417ea2f3b8423aba"
)
  throw new Error("Bundled document extractor failed its checksum.");
for (const name of [
  "core-resource-manifest.json",
  "core-runtime-audit.json",
  "publishing-resource-manifest.json",
  "nltk_data/corpora/omw-2.0.zip",
])
  if (!fs.existsSync(path.join(root, name)))
    throw new Error(`Required verified resource missing: ${name}`);
const audit = spawnSync(
  path.join(root, layout.python),
  [
    "-I",
    path.resolve("scripts/prepare-core-resources.py"),
    "--verify-only",
    "--output",
    root,
  ],
  { encoding: "utf8", windowsHide: true },
);
if (audit.status !== 0)
  throw new Error(
    `Bundled core runtime audit failed: ${audit.stderr || audit.stdout}`,
  );
if (JSON.parse(audit.stdout).status !== "passed")
  throw new Error("Bundled core runtime did not pass its isolated audit.");
console.log(
  `Alder resources verified: ${files.length} files. Python, speech, CPU verification, dictionaries, fonts and publishing tools included.`,
);
