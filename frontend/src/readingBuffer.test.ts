import { describe, it, expect } from "vitest";
import { readingBufferReady, highlightClock } from "./readingBuffer";
import type { Job } from "./types";
const job = (voiceId = "default") =>
  ({
    chunks: [
      { voiceId, playbackEligible: true, audioUrl: "/first.wav" },
      { voiceId, playbackEligible: false },
    ],
  }) as Job;
describe("reading buffer", () => {
  it("uses the declared buffering policy for new native providers", () => {
    for (const id of ["macos-voice", "espeak-voice"]) {
      const reading = job(id);
      expect(readingBufferReady(reading, 0)).toBe(false);
      reading.chunks[0].buffering = "immediate";
      expect(readingBufferReady(reading, 0)).toBe(true);
      reading.chunks[0].playbackEligible = false;
      expect(readingBufferReady(reading, 0)).toBe(false);
    }
  });
  it("starts with a rolling reserve while the rest remains queued", () => {
    const reading = job();
    reading.chunks[0].seconds = 12;
    expect(readingBufferReady(reading, 0)).toBe(false);
    Object.assign(reading.chunks[1], {
      playbackEligible: true,
      audioUrl: "/second.wav",
      seconds: 12,
    });
    reading.chunks.push({
      voiceId: "default",
      playbackEligible: false,
    } as Job["chunks"][number]);
    expect(readingBufferReady(reading, 0)).toBe(true);
    expect(readingBufferReady(reading, 0, 2)).toBe(false);
    expect(readingBufferReady(reading, 1, 1, true)).toBe(true);
    expect(readingBufferReady(reading, 2, 1, true)).toBe(false);
    expect(readingBufferReady(reading, 1)).toBe(false);
  });
  it("allows short passages and increases the reserve for slow generation", () => {
    const reading = job();
    reading.chunks.pop();
    reading.chunks[0].seconds = 3;
    expect(readingBufferReady(reading, 0)).toBe(true);
    reading.chunks[0].seconds = 25;
    reading.chunks[0].processingSeconds = 18;
    reading.chunks.push({
      voiceId: "default",
      playbackEligible: false,
    } as Job["chunks"][number]);
    expect(readingBufferReady(reading, 0)).toBe(false);
  });
  it("allows SAPI to start immediately and rejects missing audio", () => {
    expect(readingBufferReady(job("sapi-voice"), 0)).toBe(true);
    expect(readingBufferReady(null, 0)).toBe(false);
  });
  it("uses the audio clock directly at every playback speed", () => {
    expect(highlightClock(1, 1, true)).toBe(1);
    expect(highlightClock(1, 2, true)).toBe(1);
    expect(highlightClock(1, 2, false)).toBe(1);
  });
});
