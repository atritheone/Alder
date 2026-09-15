import { describe, expect, it } from "vitest";
import { SpeechTransport } from "./speechTransport";
import { codePointOffsets, mergeSpeechEvents } from "./useSpeechJob";
import type { Job } from "./types";

describe("speech session authority", () => {
  it("survives 1,000 randomized delayed control sequences without stale ownership", async () => {
    let seed = 4242;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let trial = 0; trial < 1000; trial++) {
      const pending: (() => void)[] = [];
      const ports = [0, 1].map(() => ({
        paused: true,
        play() {
          this.paused = false;
          return new Promise<void>((r) => pending.push(r));
        },
        pause() {
          this.paused = true;
        },
      }));
      const controllers = ports.map((p) => new SpeechTransport(() => p));
      for (let action = 0; action < 20; action++) {
        const c = controllers[Math.floor(random() * 2)];
        switch (Math.floor(random() * 6)) {
          case 0:
            c.prepare();
            void c.play();
            break;
          case 1:
            c.pause();
            break;
          case 2:
            void c.resume();
            break;
          case 3:
            c.stop();
            break;
          case 4:
            pending.splice(Math.floor(random() * pending.length), 1)[0]?.();
            break;
          case 5: {
            const old = c.epoch;
            c.stop();
            await c.play(old);
            break;
          }
        }
        await Promise.resolve();
        expect(ports.filter((p) => !p.paused).length).toBeLessThanOrEqual(1);
        for (const [i, controller] of controllers.entries())
          if (!controller.intent) expect(ports[i].paused).toBe(true);
      }
      controllers.forEach((c) => c.stop());
      pending.forEach((r) => r());
      await Promise.resolve();
      expect(ports.every((p) => p.paused)).toBe(true);
      expect(controllers.every((c) => c.state === "stopped")).toBe(true);
    }
  });
  it("leaves a failed audio device stopped without restoring old playback", async () => {
    const controller = new SpeechTransport(() => ({
      pause() {},
      play: async () => {
        throw new Error("output device unavailable");
      },
    }));
    controller.prepare();
    await expect(controller.play()).rejects.toThrow(
      "output device unavailable",
    );
    expect(controller.intent).toBe(false);
    expect(controller.state).toBe("failed");
    controller.stop();
  });
  it("releases the old producer when another speech surface takes control", () => {
    let cancelled = 0;
    const a = new SpeechTransport(
      () => null,
      () => cancelled++,
    );
    const b = new SpeechTransport(() => null);
    a.prepare();
    b.prepare();
    expect(a.state).toBe("stopped");
    expect(cancelled).toBe(1);
    b.stop();
  });
});

describe("incremental speech updates", () => {
  const job = {
    id: "job",
    eventSequence: 4,
    chunks: [{ id: "a", playbackEligible: true, audioUrl: "old" }],
  } as Job;
  it("ignores stale snapshots and revokes stale media URLs", () => {
    expect(
      mergeSpeechEvents(job, {
        sequence: 2,
        snapshot: { ...job, eventSequence: 2 },
      }),
    ).toBe(job);
    const next = mergeSpeechEvents(job, {
      sequence: 5,
      events: [
        {
          sequence: 5,
          header: {},
          chunks: [{ id: "a", playbackEligible: false }] as Job["chunks"],
        },
      ],
    });
    expect(next.chunks[0].audioUrl).toBeUndefined();
  });
  it("replaces the order when a rejected passage is subdivided", () => {
    const next = mergeSpeechEvents(job, {
      sequence: 5,
      events: [
        {
          sequence: 5,
          header: {},
          order: ["b", "c"],
          chunks: [{ id: "b" }, { id: "c" }] as Job["chunks"],
        },
      ],
    });
    expect(next.chunks.map((c) => c.id)).toEqual(["b", "c"]);
  });
  it("maps emoji, combining marks and repeated spaces without offset drift", () => {
    const text = "🌲 café   words 🌲";
    const offsets = codePointOffsets(text);
    expect(offsets.at(-1)).toBe(text.length);
    [...text].forEach((char, i) =>
      expect(text.slice(offsets[i], offsets[i + 1])).toBe(char),
    );
  });
});
