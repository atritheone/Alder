import type { Job } from "./types";

/** Keep a reserve of listening time, then refill only after a genuine underrun. */
export function readingBufferReady(
  job: Job | null,
  index: number,
  speed = 1,
  primed = false,
): boolean {
  const chunk = job?.chunks[index];
  if (!chunk?.playbackEligible || !chunk.audioUrl) return false;
  if (
    chunk.buffering === "immediate" ||
    (!chunk.buffering && chunk.voiceId?.startsWith("sapi-")) ||
    primed
  )
    return true;
  const recent = job!.chunks.slice(Math.max(0, index - 4), index + 8);
  const recovery = Math.max(0, ...recent.map((c) => c.processingSeconds || 0));
  const target = Math.min(45, Math.max(20, recovery * 2)) * speed;
  let seconds = 0;
  for (const section of job!.chunks.slice(index)) {
    if (!section.playbackEligible || !section.audioUrl) return false;
    seconds += (section.seconds || 0) + (job!.settings?.pauseSeconds ?? 0.18);
    if (seconds >= target) return true;
  }
  // A short remaining passage can start as soon as all of it is ready.
  return true;
}

/** Direct editor updates use the audio clock without a React-latency offset. */
export function highlightClock(
  seconds: number,
  _speed: number,
  _playing: boolean,
): number {
  return seconds;
}
