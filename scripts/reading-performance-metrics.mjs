/** Media-event measurements. Authored pauses are divided by playback speed,
 * exactly as in the reader. User control experiments are excluded. */
export function playbackGaps(samples, pauseSeconds, speed) {
  const events = samples.events.filter(
    (event) => event.at < (samples.controlsStarted ?? Infinity),
  );
  const first = events.find((event) => event.type === "playing");
  const transitions = [];
  const stalls = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const next = events.slice(i + 1).find((item) => item.type === "playing");
    if (!next || !first || event.at < first.at) continue;
    if (event.type === "ended") {
      const milliseconds = next.at - event.at;
      transitions.push({
        milliseconds,
        excessMilliseconds: Math.max(
          0,
          milliseconds - (pauseSeconds * 1000) / speed,
        ),
      });
    }
    if (event.type === "waiting" && event.time > 0 && next.src === event.src)
      stalls.push(next.at - event.at);
  }
  return {
    transitions: transitions.length,
    maximumTransitionMilliseconds: Math.max(
      0,
      ...transitions.map((gap) => gap.milliseconds),
    ),
    maximumExcessMilliseconds: Math.max(
      0,
      ...transitions.map((gap) => gap.excessMilliseconds),
    ),
    transitionsOver250MillisecondsExcess: transitions.filter(
      (gap) => gap.excessMilliseconds > 250,
    ).length,
    inSectionWaits: stalls.length,
    maximumInSectionWaitMilliseconds: Math.max(0, ...stalls),
  };
}
