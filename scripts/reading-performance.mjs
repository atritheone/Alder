import { expect } from "@playwright/test";

/** Reuse the long-document/audio fixture, with fast word boundaries deep in it. */
export async function readingPerformance(app, page, editor) {
  await app.evaluate(() => {
    const request = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await request(...args);
      if (
        !/\/api\/projects\/[^/]+\/speech$/.test(String(args[0])) ||
        args[1]?.method !== "POST"
      )
        return response;
      const job = await response.json();
      const start = job.text.indexOf("Paragraph 80.");
      const words = [...job.text.slice(start).matchAll(/\S+/g)].slice(0, 100);
      job.chunks[0].wordTimings = words.map((match, index) => ({
        text: match[0],
        sourceStart: [...job.text.slice(0, start + match.index)].length,
        sourceEnd: [...job.text.slice(0, start + match.index + match[0].length)]
          .length,
        startSeconds: index * 0.12,
        endSeconds: (index + 1) * 0.12,
      }));
      globalThis.readingBenchmarkTimings = job.chunks[0].wordTimings;
      return Response.json(job);
    };
  });
  await editor.focus();
  await editor.press("Control+Home");
  await page
    .locator(".document-reader")
    .getByLabel("Follow text", { exact: true })
    .check();
  await page.evaluate(() => {
    window.readingBenchmarkStart = performance.now();
    document.querySelector(".document-reader audio").addEventListener(
      "playing",
      () => {
        window.readingBenchmarkStarted =
          performance.now() - window.readingBenchmarkStart;
      },
      { once: true },
    );
    document
      .querySelector('.document-reader button[aria-label="Play Reading"]')
      .click();
  });
  const audio = page.locator(".document-reader audio");
  await expect
    .poll(() => audio.evaluate((audio) => audio.paused))
    .toBe(false)
    .catch(async (error) => {
      console.log(await page.locator(".document-reader").innerText());
      throw error;
    });
  const timings = await app.evaluate(() => globalThis.readingBenchmarkTimings);
  expect(timings).toHaveLength(100);
  const result = await page.evaluate(async (timings) => {
    const audio = document.querySelector(".document-reader audio");
    const editor = document.querySelector(".book-editor .ProseMirror");
    const frames = [],
      lags = [];
    let last = performance.now();
    const deadline = last + 6000;
    await new Promise((resolve) => {
      const sample = (now) => {
        frames.push(now - last);
        last = now;
        const time = audio.currentTime;
        const current = timings.findIndex(
          (word) => word.startSeconds <= time && time < word.endSeconds,
        );
        const text = editor.querySelector(".reading-word")?.textContent;
        if (current >= 0) {
          let displayed = current;
          while (displayed >= 0 && timings[displayed].text !== text)
            displayed--;
          lags.push(
            displayed < 0
              ? 1000
              : Math.max(0, time - timings[displayed].endSeconds) * 1000,
          );
        }
        if (now < deadline) setTimeout(() => sample(performance.now()), 16);
        else resolve();
      };
      sample(performance.now());
    });
    const controls = {};
    for (const [name, command, event] of [
      ["pause", "reading-toggle", "pause"],
      ["resume", "reading-toggle", "playing"],
      ["stop", "reading-stop", "pause"],
    ]) {
      const start = performance.now();
      const done = new Promise((resolve) =>
        audio.addEventListener(event, resolve, { once: true }),
      );
      window.dispatchEvent(
        new CustomEvent("alder-reading-command", { detail: command }),
      );
      await Promise.race([
        done,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `${name} timed out: paused=${audio.paused}, time=${audio.currentTime}, controls=${document.querySelector(".reader-controls").innerText}`,
                ),
              ),
            10000,
          ),
        ),
      ]);
      controls[name] = performance.now() - start;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const percentile = (values, fraction) =>
      values.sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
    return {
      pages: document.querySelectorAll(".book-editor .page-sheet").length,
      startMs: window.readingBenchmarkStarted,
      eventLoopP95Ms: percentile(frames, 0.95),
      maxEventLoopMs: Math.max(...frames),
      highlightP95LagMs: percentile(lags, 0.95),
      samples: lags.length,
      controls,
    };
  }, timings);
  console.log("READING_PERFORMANCE", JSON.stringify(result));
  if (process.env.ALDER_ASSERT_READING_PERFORMANCE) {
    expect(result.highlightP95LagMs).toBeLessThan(100);
    expect(result.eventLoopP95Ms).toBeLessThan(35);
    for (const milliseconds of Object.values(result.controls))
      expect(milliseconds).toBeLessThan(45);
  }
  return result;
}
