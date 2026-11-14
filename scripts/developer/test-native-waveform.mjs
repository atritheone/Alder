// Verify the new bounded projector against actual optional native PCM output.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const directory = path.resolve(process.argv[2]),
  report = JSON.parse(
    fs.readFileSync(path.join(directory, "system-voices.json"), "utf8"),
  );
if (!report.renders?.length) {
  console.log(
    JSON.stringify({
      status: "unavailable",
      scope: "No native PCM fixture was produced.",
    }),
  );
  process.exit(0);
}
const module = path.join(directory, "pcm-waveform.mjs");
await build({
  entryPoints: ["frontend/src/pcmWaveform.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: module,
});
const { createWavePeaks, addPcmWaveform, finishWavePeaks } = await import(
  pathToFileURL(module).href
);
for (const render of report.renders) {
  const raw = fs.readFileSync(path.join(directory, render.file));
  const peaks = createWavePeaks(render.seconds);
  await addPcmWaveform(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    peaks,
    0,
    render.seconds,
    new AbortController().signal,
    () => Promise.resolve(),
  );
  finishWavePeaks(peaks);
  if (
    !peaks.maximum.some((n) => Math.abs(n) > 0.0001) &&
    !peaks.minimum.some((n) => Math.abs(n) > 0.0001)
  )
    throw Error("Native PCM waveform unexpectedly contains no signal.");
}
console.log(
  JSON.stringify({
    status: "passed",
    renders: report.renders.length,
    scope:
      "Native PCM ingestion and bounded peak projection; independent of native word-event acceptance.",
  }),
);
