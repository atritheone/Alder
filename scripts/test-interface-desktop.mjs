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
  await expect(speedInput).toHaveValue("1.37");
  await expect(speedSlider).toHaveAttribute("step", "0.05");
  await expect(speedSlider).toHaveValue("1.35");
  await speedSlider.focus();
  await speedSlider.press("ArrowRight");
  await expect(speedInput).toHaveValue("1.40");
  await speedInput.fill("1.376");
  await speedInput.press("Enter");
  await expect(speedInput).toHaveValue("1.38");
  await speedInput.fill("9");
  await speedInput.press("Tab");
  await expect(speedInput).toHaveValue("3.00");
  await speedInput.fill("1.00");
  await speedInput.press("Tab");
  const scrollBefore = await page
    .locator(".book-editor .editor-scroll")
    .evaluate((el) => el.scrollTop);
  await speedSlider.hover();
  await page.mouse.wheel(0, -100);
  await expect(speedInput).toHaveValue("1.05");
  await page.mouse.wheel(0, 100);
  await expect(speedInput).toHaveValue("1.00");
  const volumeSlider = page.getByRole("slider", {
    name: "Reading volume",
    exact: true,
  });
  await volumeSlider.hover();
  await page.mouse.wheel(0, -100);
  await expect(volumeSlider).toHaveValue("2.05");
  await page.mouse.wheel(0, 100);
  await expect(volumeSlider).toHaveValue("2");
  expect(
    await page
      .locator(".book-editor .editor-scroll")
      .evaluate((el) => el.scrollTop),
  ).toBe(scrollBefore);
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
  const caret = page.locator(".persistent-caret .write-caret");
  await expect(caret).toHaveCount(1);
  await expect(caret).toHaveCSS("visibility", "visible");
  const nativeCaret = await writing.evaluate(() => {
    const box = document.getSelection().getRangeAt(0).getBoundingClientRect();
    return { x: box.x, y: box.y };
  });
  const caretBeforeBlur = await caret.boundingBox();
  expect(Math.abs(caretBeforeBlur.x - nativeCaret.x)).toBeLessThan(1);
  expect(Math.abs(caretBeforeBlur.y - nativeCaret.y)).toBeLessThan(1);
  await speedInput.focus();
  await expect(writing).not.toBeFocused();
  await expect(caret).toHaveCSS("visibility", "visible");
  expect(await caret.boundingBox()).toEqual(caretBeforeBlur);
  const caretStyle = await caret.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      animation: style.animationName,
      width: style.width,
      content: el.textContent,
    };
  });
  expect(caretStyle.animation).toBe("none");
  expect(caretStyle.content).toBe("");
  expect(parseFloat(caretStyle.width)).toBeCloseTo(1, 1);
  const caretScreenshot = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        {
          stayHidden: true,
          stayAwake: true,
        },
      )
    )
      .toPNG()
      .toString("base64"),
  );
  fs.writeFileSync(
    "work/write-caret-desktop.png",
    Buffer.from(caretScreenshot, "base64"),
  );

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
        const stopped = await request(
          new URL(`/api/speech/jobs/${job.id}/cancel`, url),
          { method: "POST", headers: args[1].headers },
        );
        const saved = await stopped.json();
        await new Promise((resolve) => setTimeout(resolve, 600));
        return Response.json(saved);
      }
      return response;
    };
  });
  await page.evaluate(() => {
    window.speechBoundaryMetrics = [];
    const media = document.querySelector(".document-reader audio");
    let ended;
    media.addEventListener("ended", () => {
      ended = {
        time: performance.now(),
        pause: 180 / media.playbackRate,
        job: media.src.split("/chunks/")[0],
      };
    });
    media.addEventListener("playing", () => {
      if (ended && ended.job === media.src.split("/chunks/")[0]) {
        window.speechBoundaryMetrics.push({
          gapMilliseconds: performance.now() - ended.time,
          intendedPauseMilliseconds: ended.pause,
        });
      }
      ended = undefined;
    });
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
  await expect(caret).toHaveCSS("visibility", "hidden");
  const follow = page.getByRole("checkbox", { name: /Follow Text/i });
  await follow.uncheck();
  await expect(writing).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)");
  await expect(caret).toHaveCSS("visibility", "hidden");
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
  await expect(caret).toHaveCSS("visibility", "visible");
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
  const controlMetrics = await page.evaluate(async () => {
    const root = document.querySelector(".document-reader");
    const audio = root.querySelector("audio");
    const pause = [],
      resume = [];
    for (let i = 0; i < 20; i++) {
      let started = performance.now();
      root.querySelector('[aria-label="Play Reading"]').click();
      while (audio.paused) await new Promise((r) => setTimeout(r, 1));
      resume.push(performance.now() - started);
      await new Promise((r) => setTimeout(r, 20));
      started = performance.now();
      root.querySelector('[aria-label="Pause Reading"]').click();
      pause.push(performance.now() - started);
      if (!audio.paused)
        throw new Error(
          "Pause did not silence the media element synchronously",
        );
      await new Promise((r) => setTimeout(r, 5));
    }
    return {
      pauseMilliseconds: pause,
      resumeMilliseconds: resume,
      baseLatencySeconds: window.playbackProbe.context.baseLatency,
      outputLatencySeconds: window.playbackProbe.context.outputLatency,
    };
  });
  fs.writeFileSync(
    path.resolve("work/speech-control-metrics.json"),
    JSON.stringify(controlMetrics, null, 2),
  );
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
  await reader
    .getByRole("button", { name: "Stop reading", exact: true })
    .click();
  await app.evaluate(() => {
    const prior = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await prior(...args);
      if (
        /\/api\/projects\/[^/]+\/speech$/.test(String(args[0])) &&
        args[1]?.method === "POST"
      )
        await new Promise((r) => setTimeout(r, 1200));
      return response;
    };
  });
  await writing.fill(
    "A delayed reading must stay paused until the user presses play again.",
  );
  await writing.press("Control+Home");
  await reader
    .getByRole("button", { name: "Play Reading", exact: true })
    .click();
  await reader
    .getByRole("button", { name: "Loading Reading", exact: true })
    .click();
  await expect(
    reader.getByRole("button", { name: "Play Reading", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1600);
  expect(await reader.locator("audio").evaluate((a) => a.paused)).toBe(true);
  await reader
    .getByRole("button", { name: "Play Reading", exact: true })
    .click();
  await expect
    .poll(() => reader.locator("audio").evaluate((a) => a.paused))
    .toBe(false);
  await reader
    .getByRole("button", { name: "Stop reading", exact: true })
    .click();
  for (const rate of [0.25, 1, 3]) {
    await speedInput.fill(rate.toFixed(2));
    await speedInput.press("Enter");
    await expect
      .poll(() => reader.locator("audio").evaluate((a) => a.playbackRate))
      .toBe(rate);
    expect(
      await reader.locator("audio").evaluate((a) => a.preservesPitch),
    ).toBe(true);
  }
  // Inject a failed future passage around real, checked SAPI audio. Reading
  // must reach that passage before reporting it, then retry at the same index.
  await speedInput.fill("1.00");
  await speedInput.press("Enter");
  await app.evaluate(() => {
    const prior = globalThis.fetch;
    const probe = { id: "", held: null, ready: null, resumes: 0, creates: 0 };
    globalThis.playbackRetryProbe = probe;
    globalThis.fetch = async (...args) => {
      const url = String(args[0]);
      if (probe.id && url.includes(`/api/speech/jobs/${probe.id}/events`)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const snapshot = probe.resumes ? probe.ready : probe.held;
        return Response.json({
          sequence: snapshot.eventSequence,
          snapshot,
          reset: true,
        });
      }
      if (probe.id && url.endsWith(`/api/speech/jobs/${probe.id}/resume`)) {
        probe.resumes++;
        return Response.json(probe.ready);
      }
      const response = await prior(...args);
      if (
        /\/api\/projects\/[^/]+\/speech$/.test(url) &&
        args[1]?.method === "POST"
      ) {
        probe.creates++;
        let job = await response.json();
        for (let n = 0; n < 200 && job.status !== "ready"; n++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          const current = await prior(
            new URL(`/api/speech/jobs/${job.id}`, url),
            { headers: args[1].headers },
          );
          job = await current.json();
        }
        if (job.status !== "ready" || job.chunks.length !== 3)
          throw new Error("Retry test requires three checked SAPI passages.");
        probe.id = job.id;
        probe.ready = { ...job, eventSequence: 20000 };
        probe.held = structuredClone(job);
        probe.held.eventSequence = 10000;
        probe.held.status = "failed";
        probe.held.error = "Could not read this passage. Press Play to retry.";
        delete probe.held.audioUrl;
        probe.held.chunks[1].playbackEligible = false;
        probe.held.chunks[1].verificationStatus = "needs_review";
        delete probe.held.chunks[1].audioUrl;
        return Response.json(probe.held);
      }
      return response;
    };
  });
  await writing.fill(
    "The first passage should play before any error appears. The second passage must resume here after retry. The third passage must never replace the second.",
  );
  await writing.press("Control+Home");
  await reader
    .getByRole("button", { name: "Play Reading", exact: true })
    .click();
  await expect
    .poll(() => reader.locator("audio").evaluate((a) => a.paused), {
      timeout: 20000,
    })
    .toBe(false);
  await expect(reader.getByRole("alert")).toHaveCount(0);
  await expect(reader.getByRole("alert")).toHaveText(
    "Could not read this passage. Press Play to retry.",
    { timeout: 20000 },
  );
  const retrySource = await app.evaluate(
    () => globalThis.playbackRetryProbe.ready.chunks[1].audioUrl,
  );
  await reader
    .getByRole("button", { name: "Play Reading", exact: true })
    .click();
  await expect
    .poll(() => reader.locator("audio").evaluate((a) => a.src), {
      timeout: 10000,
    })
    .toContain(retrySource);
  await expect
    .poll(() => reader.locator("audio").evaluate((a) => a.paused))
    .toBe(false);
  await expect(reader.getByRole("alert")).toHaveCount(0);
  const retryCounts = await app.evaluate(() => ({
    creates: globalThis.playbackRetryProbe.creates,
    resumes: globalThis.playbackRetryProbe.resumes,
  }));
  expect(retryCounts).toEqual({ creates: 1, resumes: 1 });
  await reader
    .getByRole("button", { name: "Stop reading", exact: true })
    .click();
  fs.writeFileSync(
    "work/speech-boundary-metrics.json",
    JSON.stringify(
      await page.evaluate(() => window.speechBoundaryMetrics),
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "work/interface-desktop-result.json",
    JSON.stringify({ ok: true, ...observed }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, ...observed }));
} catch (error) {
  console.error(error);
  throw error;
} finally {
  const timer = setTimeout(() => app.process().kill(), 10000);
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
}
