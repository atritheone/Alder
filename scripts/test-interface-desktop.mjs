import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron.exe"),
  args: [
    ".",
    "--headless-test",
    `--user-data-dir=${path.resolve(`work/interface-ui-${Date.now()}`)}`,
  ],
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
      "Skip these words. Alder   reads each word clearly. The voice   follows the writing at a precise speed. There is plenty of time to pause, move the cursor, and continue listening without losing your place.",
    );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const families = await page.evaluate(
    async () => (await window.alder.request("GET", "/api/fonts")).families,
  );
  const fontMenu = page.getByLabel("Font family", { exact: true }).first();
  const listed = await fontMenu.locator("option").allTextContents();
  expect(families.every((family) => listed.includes(family))).toBe(true);
  expect(families.length).toBeGreaterThan(10);
  await expect(fontMenu).toHaveValue("Cambria");
  const speedInput = page.getByLabel("Reading speed", { exact: true });
  const speedSlider = page.getByRole("slider", {
    name: "Reading speed slider",
    exact: true,
  });
  await speedInput.fill("1.37");
  await speedInput.press("Tab");
  await expect(speedSlider).toHaveValue("1.37");
  await speedSlider.focus();
  await speedSlider.press("ArrowRight");
  await expect(speedInput).toHaveValue("1.38");
  await speedInput.fill("1.376");
  await speedInput.press("Enter");
  await expect(speedInput).toHaveValue("1.38");
  await speedInput.fill("9");
  await speedInput.press("Tab");
  await expect(speedInput).toHaveValue("3.00");
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
  await page.getByLabel("Reading speed", { exact: true }).fill("0.93");
  await expect(page.getByLabel("Reading scope")).toHaveCount(0);
  const writing = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await writing.press("Control+Home");
  for (let i = 0; i < "Skip these words. ".length; i++)
    await writing.press("ArrowRight");

  // Present the first job as interrupted, with a delayed response. Resuming
  // must reuse that job through the real resume API instead of creating anew.
  await app.evaluate(() => {
    const request = globalThis.fetch;
    globalThis.readingResumeProbe = { first: true, resumes: 0, jobId: null };
    globalThis.fetch = async (...args) => {
      const url = String(args[0]);
      if (url.endsWith("/resume") && args[1]?.method === "POST")
        globalThis.readingResumeProbe.resumes++;
      const response = await request(...args);
      if (
        globalThis.readingResumeProbe.first &&
        /\/api\/projects\/[^/]+\/speech$/.test(url) &&
        args[1]?.method === "POST"
      ) {
        globalThis.readingResumeProbe.first = false;
        const job = await response.json();
        globalThis.readingResumeProbe.jobId = job.id;
        await new Promise((resolve) => setTimeout(resolve, 600));
        return Response.json({ ...job, status: "interrupted" });
      }
      return response;
    };
  });
  await expect(page.getByLabel("Reading audio format")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Resume rendering", exact: true }),
  ).toHaveCount(0);
  await page
    .locator(".document-reader")
    .getByRole("button", { name: "Play Reading", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Loading Reading", exact: true }),
  ).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".reading-spinner")).toHaveCSS(
    "animation-name",
    "reading-spin",
  );
  await page
    .locator(".document-reader")
    .getByRole("button", { name: "Play Reading", exact: true })
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
  await expect(writing).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  const follow = page.getByRole("checkbox", { name: /Follow Text/i });
  await follow.uncheck();
  await expect(writing).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await follow.check();
  const speech = await page.evaluate(async () => {
    const id = document
      .querySelector(".document-reader audio")
      .src.match(/speech\/jobs\/([^/]+)/)[1];
    const job = await window.alder.request("GET", `/api/speech/jobs/${id}`);
    window.testSpeech = job;
    return job;
  });
  expect(speech.text).toMatch(/^Alder   reads/);
  const resumeProbe = await app.evaluate(() => globalThis.readingResumeProbe);
  expect(resumeProbe.resumes).toBe(1);
  expect(speech.id).toBe(resumeProbe.jobId);
  const observed = await page.evaluate(async () => {
    let maximumWords = 0,
      highlights = 0,
      mismatches = [];
    for (let i = 0; i < 80; i++) {
      const text = document.querySelector(".reading-word")?.textContent?.trim();
      if (text) {
        highlights++;
        maximumWords = Math.max(maximumWords, text.split(/\s+/).length);
      }
      const audio = document.querySelector(".document-reader audio");
      const chunk = window.testSpeech.chunks.find((c) =>
        audio.src.endsWith(`/chunks/${c.id}`),
      );
      const expected = chunk?.wordTimings?.find(
        (w) =>
          audio.currentTime > w.startSeconds + 0.08 &&
          audio.currentTime < w.endSeconds - 0.08,
      );
      if (text && expected && text !== expected.text)
        mismatches.push({ text, expected: expected.text });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return {
      maximumWords,
      highlights,
      mismatches,
      gain: window.playbackProbe.gain.gain.value,
      speed: document.querySelector(".document-reader audio").playbackRate,
    };
  });
  expect(observed.mismatches).toEqual([]);
  expect(observed.maximumWords).toBe(1);
  expect(observed.highlights).toBeGreaterThan(10);
  expect(observed.gain).toBeCloseTo(2);
  expect(observed.speed).toBeCloseTo(0.93);
  const reader = page.locator(".document-reader");
  await expect(
    reader.getByRole("button", { name: "Read", exact: true }),
  ).toHaveCount(0);
  await expect(reader.locator("datalist")).toHaveCount(0);
  await expect(speedSlider).toHaveCSS("background-image", "none");
  expect((await speedInput.boundingBox()).width).toBeLessThan(55);
  await reader
    .getByRole("button", { name: "Pause Reading", exact: true })
    .click();
  await expect
    .poll(() => reader.locator("audio").evaluate((a) => a.paused))
    .toBe(true);
  await expect(writing).not.toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  const pausedCaret = await page.evaluate(async () => {
    const editor = document.querySelector('[aria-label="Chapter text editor"]');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    const audio = document.querySelector(".document-reader audio");
    const id = audio.src.match(/speech\/jobs\/([^/]+)/)[1];
    const job = await window.alder.request("GET", `/api/speech/jobs/${id}`);
    const chunk = job.chunks.find((c) => audio.src.endsWith(`/chunks/${c.id}`));
    const word = chunk.wordTimings.find(
      (w) => audio.currentTime < w.endSeconds,
    );
    return {
      offset: range.toString().length,
      expected:
        "Skip these words. ".length +
        chunk.sourceStart +
        (word?.sourceStart ?? chunk.sourceEnd - chunk.sourceStart),
      collapsed: selection.isCollapsed,
    };
  });
  expect(pausedCaret.collapsed).toBe(true);
  expect(pausedCaret.offset).toBe(pausedCaret.expected);
  expect(pausedCaret.offset).toBeGreaterThan("Skip these words. ".length);
  const originalSource = await reader.locator("audio").evaluate((a) => a.src);
  await reader
    .getByRole("button", { name: "Play Reading", exact: true })
    .click();
  await expect
    .poll(() => reader.locator("audio").evaluate((a) => a.paused))
    .toBe(false);
  expect(await reader.locator("audio").evaluate((a) => a.src)).toBe(
    originalSource,
  );
  // Stopping also parks the cursor, and Play retains the exact audio position.
  await reader
    .getByRole("button", { name: "Stop reading", exact: true })
    .click();
  const stoppedTime = await reader
    .locator("audio")
    .evaluate((a) => a.currentTime);
  expect(stoppedTime).toBeGreaterThan(0);
  await reader
    .getByRole("button", { name: "Play Reading", exact: true })
    .click();
  await expect
    .poll(() => reader.locator("audio").evaluate((a) => a.paused))
    .toBe(false);
  expect(await reader.locator("audio").evaluate((a) => a.src)).toBe(
    originalSource,
  );
  expect(
    await reader.locator("audio").evaluate((a) => a.currentTime),
  ).toBeGreaterThanOrEqual(stoppedTime);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const editor = document.querySelector(
            '[aria-label="Chapter text editor"]',
          );
          const selection = window.getSelection();
          if (!editor.contains(selection.anchorNode)) return false;
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.setEnd(selection.anchorNode, selection.anchorOffset);
          return (
            range.toString().length === editor.textContent.length &&
            selection.isCollapsed
          );
        }),
      { timeout: 20000 },
    )
    .toBe(true);
  const completedSource = await reader.locator("audio").evaluate((a) => a.src);
  await writing.press("Control+a");
  await page.keyboard.insertText(
    "This is new wording. Play should read the revised document, with no separate Read button.",
  );
  await expect(writing).toHaveText(
    "This is new wording. Play should read the revised document, with no separate Read button.",
  );
  await writing.press("Control+Home");
  await reader
    .getByRole("button", { name: "Play Reading", exact: true })
    .click();
  await expect
    .poll(() => reader.locator("audio").evaluate((a) => a.src), {
      timeout: 20000,
    })
    .not.toBe(completedSource);
  await expect
    .poll(() => reader.locator("audio").evaluate((a) => a.paused))
    .toBe(false);
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "work/interface-desktop-result.json",
    JSON.stringify({ ok: true, ...observed }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, ...observed }));
} finally {
  await app.close();
}
