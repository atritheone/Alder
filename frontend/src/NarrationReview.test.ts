// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import NarrationReview from "./NarrationReview";
import type { Job } from "./types";
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
