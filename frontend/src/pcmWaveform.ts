/** Peak projection from verified PCM chunks. Never decode a whole recording. */
export type WavePeaks = {
  minimum: Float32Array;
  maximum: Float32Array;
  seconds: number;
};
export function createWavePeaks(seconds: number, resolution = 1000): WavePeaks {
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    !Number.isInteger(resolution) ||
    resolution < 1 ||
    resolution > 4000
  )
    throw Error("Invalid waveform geometry.");
  // Keep the zero baseline used by the original display, including pauses
  // which occupy only part of a pixel between two generated passages.
  return {
    minimum: new Float32Array(resolution),
    maximum: new Float32Array(resolution),
    seconds,
  };
}
export async function addPcmWaveform(
  buffer: ArrayBuffer,
  peaks: WavePeaks,
  offset: number,
  expectedSeconds: number,
  signal: AbortSignal,
  yieldWork: () => Promise<void>,
  clock = () => performance.now(),
) {
  signal.throwIfAborted();
  if (buffer.byteLength > 32 * 1024 * 1024)
    throw Error("This passage exceeds the waveform memory limit.");
  const view = new DataView(buffer),
    tag = (at: number) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (buffer.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE")
    throw Error("The passage has no readable PCM waveform.");
  let channels = 0,
    rate = 0,
    bits = 0,
    format = 0,
    data = 0,
    bytes = 0;
  for (let at = 12; at + 8 <= buffer.byteLength; ) {
    const size = view.getUint32(at + 4, true),
      next = at + 8 + size;
    if (next > buffer.byteLength)
      throw Error("The saved passage is incomplete.");
    if (tag(at) === "fmt " && size >= 16) {
      format = view.getUint16(at + 8, true);
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    }
    if (tag(at) === "data") {
      data = at + 8;
      bytes = size;
    }
    at = next + (size % 2);
  }
  if (
    format !== 1 ||
    channels !== 1 ||
    rate !== 24000 ||
    bits !== 16 ||
    !data ||
    bytes % 2
  )
    throw Error("The passage is not a verified mono PCM waveform.");
  const frames = bytes / 2,
    seconds = frames / rate;
  if (
    !Number.isFinite(offset) ||
    offset < 0 ||
    !Number.isFinite(expectedSeconds) ||
    Math.abs(seconds - expectedSeconds) > 0.1 ||
    offset + seconds > peaks.seconds + 0.1
  )
    throw Error("The saved waveform timing changed. Reopen the recording.");
  let slice = clock();
  for (let from = 0; from < frames; from += 4096) {
    signal.throwIfAborted();
    for (let i = from; i < Math.min(from + 4096, frames); i++) {
      const pixel = Math.min(
        peaks.minimum.length - 1,
        Math.floor(
          ((offset + i / rate) / peaks.seconds) * peaks.minimum.length,
        ),
      );
      const value = view.getInt16(data + i * 2, true) / 32768;
      peaks.minimum[pixel] = Math.min(peaks.minimum[pixel], value);
      peaks.maximum[pixel] = Math.max(peaks.maximum[pixel], value);
    }
    if (clock() - slice >= 6) {
      await yieldWork();
      signal.throwIfAborted();
      slice = clock();
    }
  }
}
export function finishWavePeaks(peaks: WavePeaks) {
  for (let i = 0; i < peaks.minimum.length; i++)
    if (!Number.isFinite(peaks.minimum[i]))
      peaks.minimum[i] = peaks.maximum[i] = 0;
  return peaks;
}
export function yieldWaveform(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 0);
    signal.addEventListener("abort", abort, { once: true });
  });
}
