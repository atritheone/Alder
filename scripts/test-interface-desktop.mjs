import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron.exe"),
  args: [".", "--headless-test"],
  env: {
    ...process.env,
    ALDER_DATA_DIR: path.resolve(`work/interface-desktop-${Date.now()}`),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      console.log(message.type(), message.text());
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .fill(
      "Alder reads each word clearly. The voice follows the writing at a precise speed.",
    );
  await expect(page.locator(".save-status")).toHaveText("All changes saved");
  // Observe the actual playback graph, including the cross-origin media source.
  await page.evaluate(() => {
    const original = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function () {
      const gain = original.call(this);
      const analyser = this.createAnalyser();
      gain.connect(analyser);
      window.playbackProbe = { gain, analyser, context: this };
      return gain;
    };
  });
  const voices = await page
    .locator(
      'select[aria-label="Reading voice"] optgroup[label="Windows SAPI"] option',
    )
    .evaluateAll((nodes) => nodes.map((n) => n.value));
  if (!voices.length)
    throw new Error("Desktop verification requires an installed SAPI voice");
  await page.getByLabel("Reading voice").selectOption(voices[0]);
  await page.getByLabel("Reading speed", { exact: true }).fill("0.937");
  await page
    .locator(".document-reader")
    .getByRole("button", { name: "Read", exact: true })
    .click();
  try {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const probe = window.playbackProbe;
            if (!probe) return 0;
            const samples = new Float32Array(probe.analyser.fftSize);
            probe.analyser.getFloatTimeDomainData(samples);
            return Math.max(...samples.map(Math.abs));
          }),
        { timeout: 20000, intervals: [50, 100] },
      )
      .toBeGreaterThan(0.001);
  } catch (error) {
    console.log(
      await page.evaluate(() => ({
        text: document.body.innerText,
        context: window.playbackProbe?.context.state,
        audio: [...document.querySelectorAll("audio")].map((a) => ({
          src: a.src,
          time: a.currentTime,
          error: a.error?.message,
          paused: a.paused,
          ready: a.readyState,
        })),
      })),
    );
    throw error;
  }
  const observed = await page.evaluate(async () => {
    let maximumWords = 0,
      highlights = 0;
    for (let i = 0; i < 80; i++) {
      const text = document.querySelector(".reading-word")?.textContent?.trim();
      if (text) {
        highlights++;
        maximumWords = Math.max(maximumWords, text.split(/\s+/).length);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return {
      maximumWords,
      highlights,
      gain: window.playbackProbe.gain.gain.value,
      speed: document.querySelector(".document-reader audio").playbackRate,
    };
  });
  expect(observed.maximumWords).toBe(1);
  expect(observed.highlights).toBeGreaterThan(10);
  expect(observed.gain).toBeCloseTo(2);
  expect(observed.speed).toBeCloseTo(0.937);
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "work/interface-desktop-result.json",
    JSON.stringify({ ok: true, ...observed }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, ...observed }));
} finally {
  await app.close();
}
