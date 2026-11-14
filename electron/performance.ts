import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const origin = performance.now() - process.uptime() * 1000;
const run = randomUUID();
const events: {
  event: string;
  ms: number;
  duration?: number;
  operation?: string;
}[] = [];
let dropped = 0;
let writing = false;
let dirty = false;
async function writeReport(destination: string) {
  dirty = true;
  if (writing) return;
  writing = true;
  try {
    while (dirty) {
      dirty = false;
      try {
        await fs.writeFile(destination, JSON.stringify(performanceReport()));
      } catch {}
    }
  } finally {
    writing = false;
  }
}
export function mark(event: string, duration?: number, operation?: string) {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(event)) return;
  if (events.length === 512) {
    events.splice(128, 1);
    dropped++;
  }
  const row = {
    event,
    ms: performance.now() - origin,
    ...(Number.isFinite(duration) && duration! >= 0 ? { duration } : {}),
    ...(operation && /^[a-f0-9-]{36}$/.test(operation) ? { operation } : {}),
  };
  events.push(row);
  const destination = process.env.ALDER_PERFORMANCE_OUTPUT;
  if (destination) void writeReport(destination);
}
export const performanceReport = () => ({
  version: 1,
  run,
  platform: process.platform,
  dropped,
  events: [...events],
});
mark("process.entry");
