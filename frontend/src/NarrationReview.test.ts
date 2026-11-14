// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import NarrationReview from "./NarrationReview";
import type { Job } from "./types";
import { webcrypto } from "node:crypto";
it("bounds large recording DOM, preserves review drafts across pages and keeps original chunk identities", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const job = {
    id: "large",
    status: "needs_review",
    reviewStatus: "needs_review",
    strictVerification: true,
    chunks: Array.from({ length: 10000 }, (_, i) => ({
      id: `chunk-${i}`,
      text: `Passage ${i}`,
      status: "ready",
    })),
  } as Job;
  const review = vi.fn(async () => {});
  try {
    await act(async () =>
      root.render(
        createElement(NarrationReview, {
          job,
          onReview: review,
          onPlayChunk: () => {},
          onSeek: () => {},
        }),
      ),
    );
    expect(container.querySelectorAll(".narration-chunk-review")).toHaveLength(
      50,
    );
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Review note for chunk 1"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Keep this listening note.");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = (text: string) =>
      [...container.querySelectorAll("button")].find(
        (b) => b.textContent === text,
      )!;
    await act(async () => button("Next chunks").click());
    expect(
      container.querySelector(".narration-chunk-review strong")?.textContent,
    ).toBe("Chunk 51");
    await act(async () => button("Previous chunks").click());
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Review note for chunk 1"]',
      )!.value,
    ).toBe("Keep this listening note.");
    expect(container.querySelectorAll(".narration-chunk-review")).toHaveLength(
      50,
    );
    expect(review).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
it("reads verified PCM chunks with a bounded projection and invalidates cached peaks when audio changes", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const buffer = new ArrayBuffer(52),
    view = new DataView(buffer);
  const tag = (at: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, 44, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, 8, true);
  [1000, -1000, 2000, -2000].forEach((n, i) =>
    view.setInt16(44 + i * 2, n, true),
  );
  const fetcher = vi.fn(
    async (_input: string) =>
      new Response(buffer.slice(0), { headers: { "Content-Length": "52" } }),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("crypto", webcrypto);
  const decoder = vi.fn();
  vi.stubGlobal("AudioContext", decoder);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let job = {
    id: "wave",
    status: "ready",
    reviewStatus: "needs_review",
    audioUrl: "/complete-recording",
    seconds: 4 / 24000,
    chunks: [
      {
        id: "one",
        text: "Synthetic PCM",
        status: "ready",
        audioUrl: "/verified-chunk",
        seconds: 4 / 24000,
        startSeconds: 0,
        playbackEligible: true,
        qa: { status: "matched", audioHash: "a".repeat(64) },
      },
    ],
  } as Job;
  const render = () =>
    root.render(
      createElement(NarrationReview, {
        job,
        onPlayChunk: () => {},
        onSeek: () => {},
      }),
    );
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    )!;
  const loaded = async () => {
    for (let i = 0; i < 100 && !container.querySelector("canvas"); i++)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    expect(container.querySelector("canvas")).not.toBeNull();
  };
  try {
    await act(async () => render());
    await act(async () => button("Show waveform").click());
    await loaded();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/verified-chunk");
    expect(decoder).not.toHaveBeenCalled();
    await act(async () => button("Hide waveform").click());
    await act(async () => button("Show waveform").click());
    await loaded();
    expect(fetcher).toHaveBeenCalledTimes(1);
    job = {
      ...job,
      chunks: [
        {
          ...job.chunks[0],
          qa: { status: "matched", audioHash: "b".repeat(64) },
        },
      ],
    };
    await act(async () => render());
    await loaded();
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
