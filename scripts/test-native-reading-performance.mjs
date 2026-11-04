// Actual synthesis and media playback in an isolated test profile.
// Muted output measures media clocks/events, not acoustic device latency.
import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { playbackGaps } from "./reading-performance-metrics.mjs";

const engine =
  process.env.ALDER_READING_ENGINE === "chatterbox" ? "chatterbox" : "native";
const paragraphs = Number(process.env.ALDER_READING_PARAGRAPHS || 500);
const hyphenation = process.env.ALDER_READING_HYPHENATION === "1";
const batchBoundary = process.env.ALDER_READING_BATCH_BOUNDARY === "1";
const playbackSpeed = batchBoundary ? 3 : 1.5;
if (!Number.isInteger(paragraphs) || paragraphs < 500 || paragraphs > 4000)
  throw Error("Choose 500–4000 paragraphs for the reading benchmark.");
const directory = path.resolve(`work/${engine}-reading-performance${paragraphs === 500 && !hyphenation ? "" : `-${paragraphs}${hyphenation ? "-hyphenation" : ""}`}${batchBoundary ? "-batch-boundary" : ""}`);
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-native-reading-"));
const report = {
  status: "running",
  engine,
  paragraphs,
  hyphenation,
  batchBoundary,
  playbackSpeed,
  errors: [],
  machine: {
    platform: process.platform,
    architecture: process.arch,
    cpu: os.cpus()[0]?.model,
    font: "Cambria",
    measuredAt: new Date().toISOString(),
  },
  limitations: [
    "Muted media playback; hardware/acoustic output and other platforms are not certified.",
  ],
};
let app, page;
const save = () =>
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
save();
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1440, 1000);
    window.show();
    window.focus();
    const request = globalThis.fetch;
    globalThis.nativeReadingJobs = [];
    globalThis.fetch = async (...args) => {
      const start = performance.now();
      const response = await request(...args);
      if (
        /\/api\/projects\/[^/]+\/speech$/.test(String(args[0])) &&
        args[1]?.method === "POST"
      )
        globalThis.nativeReadingJobs.push({
          ...(await response.clone().json()),
          submissionMilliseconds: performance.now() - start,
        });
      return response;
    };
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const fixture = await page.evaluate(async ({engine, paragraphs, hyphenation, batchBoundary, playbackSpeed}) => {
    localStorage.setItem("alder.readingVolume", "0");
    localStorage.setItem("alder.readingSpeed", String(playbackSpeed));
    const voices = await window.alder.request("GET", "/api/speech/voices");
    const voice = voices.voices.find(
      (v) =>
        (engine === "chatterbox" ? v.id === "default" : v.kind === "sapi") &&
        v.available !== false &&
        (!v.culture || v.culture.startsWith("en")),
    );
    if (!voice)
      throw Error(
        `This benchmark requires an available ${engine === "chatterbox" ? "Chatterbox" : "English SAPI"} voice.`,
      );
    const p = await window.alder.request("POST", "/api/projects", {
      name: "Native reading benchmark",
      template: "blank",
    });
    Object.assign(p.settings, {
      documentKind: "docx",
      includeTitle: false,
      includeToc: false,
      fontFamily: "Cambria",
      fontSize: 12,
    });
    const subjects = [
      "A painter",
      "The gardener",
      "A musician",
      "The writer",
      "A traveller",
      "The librarian",
      "A teacher",
      "The visitor",
    ];
    const actions = [
      "studies the colours",
      "notices the changing light",
      "remembers an old conversation",
      "listens to the birds",
      "watches the distant boats",
      "examines the folded map",
      "reads a letter",
      "considers the journey",
    ];
    const places = [
      "beside the river",
      "under the tall trees",
      "near the harbour",
      "outside the village",
      "at the garden gate",
      "inside the quiet house",
      "beyond the stone bridge",
      "on the shaded path",
    ];
    p.book = {
      version: 1,
      chapters: [{ id: "native-reading", title: "Document", include: true }],
    };
    p.book.chapters[0].voiceId = voice.id;
    p.book.chapters[0].document = {
      type: "doc",
      content: Array.from({ length: paragraphs }, (_, i) => ({
        type: "paragraph",
        attrs: { blockId: `reading-${i}`, ...(hyphenation ? {hyphenation: true} : {}) },
        content: [
          {
            type: "text",
            text:
              (batchBoundary && i === 0 ? 'Read. '.repeat(72) : '') +
              `Paragraph ${i + 1}. ` +
              Array.from({ length: 4 }, (_, part) => {
                const n = i * 4 + part;
                return `${subjects[n % 8]} ${actions[Math.floor(n / 8) % 8]} ${places[Math.floor(n / 64) % 8]}. ${subjects[(n + 3) % 8]} ${actions[Math.floor((n + 17) / 8) % 8]} ${places[Math.floor((n + 73) / 64) % 8]}, taking a moment to notice the details of the unfamiliar surroundings. `;
              }).join(""),
          },
        ],
      })),
    };
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return { id: p.id, voice };
  }, {engine, paragraphs, hyphenation, batchBoundary, playbackSpeed});
  report.voice = fixture.voice;
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  const openedAt = performance.now();
  await page
    .locator(".project-list-item")
    .filter({ hasText: "Native reading benchmark" })
    .click();
  const write = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(write).toBeVisible({timeout: 120000});
  await expect
    .poll(() => page.locator(".book-editor .page-sheet").count(), {timeout: 120000})
    .toBeGreaterThan(Math.floor(paragraphs / 5));
  report.openMilliseconds = performance.now() - openedAt;
  report.pages = await page.locator(".book-editor .page-sheet").count();
  await write.press("Control+Home");
  const toggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Sandbox", exact: true })
    .click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await sandbox.fill("A draft to edit while listening. ");
  const reader = page.locator(".book-main .document-reader");
  await expect(reader.getByLabel("Reading voice")).toHaveValue(
    fixture.voice.id,
  );
  // Prepare the real engine explicitly; retain preparation separately from Play.
  report.preparationMilliseconds = await page.evaluate(async (voiceId) => {
    const start = performance.now();
    await window.alder.request("POST", "/api/speech/prepare", { voiceId });
    return performance.now() - start;
  }, fixture.voice.id);
  await reader.locator("audio").evaluate((audio) => {
    window.__nativePlayback = {
      start: performance.now(),
      started: null,
      events: [],
      frames: [],
      highlights: [],
      typing: [],
      sources: [],
    };
    for (const type of [
      "playing",
      "waiting",
      "stalled",
      "pause",
      "ended",
      "error",
    ])
      audio.addEventListener(type, () => {
        const p = window.__nativePlayback;
        p.events.push({
          type,
          at: performance.now(),
          time: audio.currentTime,
          src: audio.currentSrc,
        });
        if (type === "playing" && p.started === null)
          p.started = performance.now() - p.start;
      });
    let last = performance.now();
    window.__nativePlaybackRunning = true;
    const sample = (now) => {
      const p = window.__nativePlayback;
      p.frames.push(now - last);
      last = now;
      if (audio.currentSrc && p.sources.at(-1) !== audio.currentSrc)
        p.sources.push(audio.currentSrc);
      p.highlights.push({
        at: now,
        time: audio.currentTime,
        src: audio.currentSrc,
        paused: audio.paused,
        word:
          document.querySelector(".book-editor .reading-word")?.textContent ||
          "",
      });
      if (window.__nativePlaybackRunning) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await reader
    .getByRole("button", { name: "Play Reading", exact: true })
    .click();
  await expect
    .poll(
      () =>
        reader
          .locator("audio")
          .evaluate((a) => !a.paused && a.currentTime > 0.1),
      { timeout: engine === "chatterbox" ? 180000 : 60000 },
    )
    .toBe(true);
  await sandbox.focus();
  await sandbox.press("Control+End");
  await sandbox.evaluate((element) =>
    element.addEventListener("keydown", (event) => {
      if (
        event.key.length !== 1 ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      )
        return;
      const start = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          window.__nativePlayback.typing.push(performance.now() - start),
        ),
      );
    }),
  );
  // Native typing, proofreading scheduling, autosave and body follow-scroll all
  // remain enabled. Editing the narrated wording itself intentionally stops it.
  const sampleSeconds = Math.min(
    90,
    Math.max(20, Number(process.env.ALDER_READING_SAMPLE_SECONDS) || 22),
  );
  await sandbox.pressSequentially(
    "Writing beside a long manuscript should stay responsive. The sentence can change while the narrator continues. ".repeat(
      Math.ceil(sampleSeconds / 11.1),
    ),
    { delay: 100, timeout: sampleSeconds * 1000 + 30000 },
  );
  await expect(
    reader.getByRole("button", { name: "Pause Reading", exact: true }),
  ).toBeVisible();
  const jobId = await app.evaluate(
    () => globalThis.nativeReadingJobs.at(-1).id,
  );
  report.submissionMilliseconds = await app.evaluate(
    () => globalThis.nativeReadingJobs.at(-1).submissionMilliseconds,
  );
  report.initialPlan = await app.evaluate(() => {
    const job = globalThis.nativeReadingJobs.at(-1);
    return { sections: job.chunks.length, hasMoreText: job.hasMoreText };
  });
  report.job = await page.evaluate(async (id) => {
    const job = await window.alder.request("GET", `/api/speech/jobs/${id}`);
    return {
      status: job.status,
      plannedSections: job.chunks.length,
      hasMoreText: job.hasMoreText,
      pauseSeconds: job.settings?.pauseSeconds ?? 0.18,
      chunks: job.chunks
        .filter((c) => c.playbackEligible)
        .map((c) => ({
          id: c.id,
          audioUrl: c.audioUrl,
          seconds: c.seconds,
          wordTimings: c.wordTimings,
        })),
    };
  }, jobId);
  report.controls = await reader.locator("audio").evaluate(async (audio) => {
    window.__nativePlayback.controlsStarted = performance.now();
    const values = {};
    for (const [name, command, event] of [
      ["pause", "reading-toggle", "pause"],
      ["resume", "reading-toggle", "playing"],
      ["stop", "reading-stop", "pause"],
    ]) {
      const start = performance.now();
      const wait = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error(`${name} timed out`)),
          10000,
        );
        audio.addEventListener(
          event,
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      window.dispatchEvent(
        new CustomEvent("alder-reading-command", { detail: command }),
      );
      await wait;
      values[name] = performance.now() - start;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    window.__nativePlaybackRunning = false;
    return values;
  });
  const samples = await page.evaluate(() => window.__nativePlayback);
  fs.writeFileSync(
    path.join(directory, "samples.json"),
    JSON.stringify(samples),
  );
  const percentile = (values, fraction) =>
    [...values].sort((a, b) => a - b)[
      Math.floor((values.length - 1) * fraction)
    ];
  report.playMilliseconds = samples.started;
  report.frameP95Milliseconds = percentile(samples.frames, 0.95);
  report.typingP95Milliseconds = percentile(samples.typing, 0.95);
  report.typedKeys = samples.typing.length;
  report.playedSources = samples.sources.length;
  report.events = samples.events;
  report.gaps = playbackGaps(samples, report.job.pauseSeconds, playbackSpeed);
  const matched = [],
    missed = [];
  const clean = (text) =>
    text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (const sample of samples.highlights) {
    if (sample.paused) continue;
    const chunk = report.job.chunks.find((c) =>
      sample.src.endsWith(c.audioUrl),
    );
    if (!chunk) continue;
    const timing = chunk.wordTimings.find(
      (w) => w.startSeconds <= sample.time && sample.time < w.endSeconds,
    );
    if (!timing) continue;
    const record = { ...sample, expected: timing.text };
    (clean(timing.text) === clean(sample.word) ? matched : missed).push(record);
  }
  report.highlightSamples = {
    matched: matched.length,
    mismatched: missed.length,
    limitation:
      "Frame samples can straddle word boundaries or short alignment gaps. This compares displayed text with engine timing, not acoustic output.",
  };
  fs.writeFileSync(
    path.join(directory, "highlight-mismatches.json"),
    JSON.stringify(missed, null, 2),
  );
  await expect(sandbox).toContainText(
    "The sentence can change while the narrator continues.",
  );
  expect(report.typedKeys).toBeGreaterThan(150);
  expect(report.errors).toEqual([]);
  if (batchBoundary) {
    expect(report.initialPlan).toEqual({ sections: 64, hasMoreText: true });
    expect(report.playedSources).toBeGreaterThan(64);
    expect(report.job.plannedSections).toBeGreaterThan(64);
    expect(report.gaps.inSectionWaits).toBe(0);
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  save();
  await app?.close();
}
