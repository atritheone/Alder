import { it, expect } from "vitest";
import {
  createWavePeaks,
  addPcmWaveform,
  finishWavePeaks,
} from "./pcmWaveform";
function pcm(samples: number[]) {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const tag = (at: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((n, i) => view.setInt16(44 + i * 2, n, true));
  return buffer;
}
it("projects exact PCM peaks across chunk offsets and silent gaps without an audio decoder", async () => {
  const peaks = createWavePeaks(8 / 24000, 4),
    signal = new AbortController().signal;
  await addPcmWaveform(
    pcm([1000, -2000, 3000, -4000]),
    peaks,
    0,
    4 / 24000,
    signal,
    async () => {},
  );
  await addPcmWaveform(
    pcm([12000, -16000]),
    peaks,
    6 / 24000,
    2 / 24000,
    signal,
    async () => {},
  );
  finishWavePeaks(peaks);
  expect([...peaks.minimum]).toEqual([
    -2000 / 32768,
    -4000 / 32768,
    0,
    -16000 / 32768,
  ]);
  expect([...peaks.maximum]).toEqual([
    1000 / 32768,
    3000 / 32768,
    0,
    12000 / 32768,
  ]);
});
it("rejects oversized, damaged, unverified-format and stale-timing input", async () => {
  const peaks = createWavePeaks(1),
    signal = new AbortController().signal;
  for (const buffer of [
    new ArrayBuffer(32 * 1024 * 1024 + 1),
    new ArrayBuffer(10),
    pcm([1]).slice(0, 44),
  ])
    await expect(
      addPcmWaveform(buffer, peaks, 0, 1, signal, async () => {}),
    ).rejects.toThrow();
  const stereo = pcm([1]);
  new DataView(stereo).setUint16(22, 2, true);
  await expect(
    addPcmWaveform(stereo, peaks, 0, 1, signal, async () => {}),
  ).rejects.toThrow();
  await expect(
    addPcmWaveform(pcm([1]), peaks, 2, 1, signal, async () => {}),
  ).rejects.toThrow();
});
it("yields bounded batches and acknowledges cancellation before scanning more samples", async () => {
  const controller = new AbortController();
  let yields = 0,
    clock = 0;
  await expect(
    addPcmWaveform(
      pcm(Array(20000).fill(123)),
      createWavePeaks(1),
      0,
      20000 / 24000,
      controller.signal,
      async () => {
        yields++;
        controller.abort();
      },
      () => (clock += 7),
    ),
  ).rejects.toThrow();
  expect(yields).toBe(1);
});
