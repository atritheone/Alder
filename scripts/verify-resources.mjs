import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(process.argv[2] || "work/bundle-resources");
const required = [
  "python/python.exe",
  "python/Lib/site-packages/fastapi/__init__.py",
  "speech/python/python.exe",
  "speech/chatterbox/src/chatterbox/tts_turbo.py",
  "speech/models/turbo/t3_turbo_v1.safetensors",
  "speech/models/turbo/s3gen_meanflow.safetensors",
  "speech/models/turbo/ve.safetensors",
  "speech/ffmpeg/ffmpeg.exe",
  "speech/ffmpeg/ffprobe.exe",
  "speech/qa/python/python.exe",
  "fonts/LiberationSerif-Regular.ttf",
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
  ["Calibre", /tools\/calibre\/.*ebook-convert\.exe$/i],
  ["Java", /tools\/(java|jre)\/.*java\.exe$/i],
  ["EPUBCheck", /tools\/epubcheck\/.*epubcheck\.jar$/i],
  ["WordNet", /nltk_data\/corpora\/wordnet(\.zip|\/)/i],
  ["QA model", /speech\/qa\/models\/.*model\.bin$/i],
])
  if (!files.some((f) => test.test(f))) missing.push(name);
if (missing.length)
  throw new Error("Incomplete self-contained resources: " + missing.join(", "));
for (const name of [
  "core-resource-manifest.json",
  "core-runtime-audit.json",
  "publishing-resource-manifest.json",
  "nltk_data/corpora/omw-2.0.zip",
])
  if (!fs.existsSync(path.join(root, name)))
    throw new Error(`Required verified resource missing: ${name}`);
const audit = spawnSync(
  path.join(root, "python/python.exe"),
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
