import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const origin = performance.now() - process.uptime() * 1000;
const run = randomUUID();
const events: { event: string; ms: number; duration?: number }[] = [];
let writing = Promise.resolve();
export function mark(event: string, duration?: number) {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(event) || events.length >= 512) return;
  const row = { event, ms: performance.now() - origin,
    ...(Number.isFinite(duration) && duration! >= 0 ? { duration } : {}) };
  events.push(row);
  const destination = process.env.ALDER_PERFORMANCE_OUTPUT;
  if (destination) writing = writing.then(() => fs.writeFile(destination,
    JSON.stringify({ version: 1, run, platform: process.platform, events }, null, 2))).catch(() => {});
}
export const performanceReport = () => ({ version: 1, run, platform: process.platform, events: [...events] });
mark("process.entry");
