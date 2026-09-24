import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const report = path.resolve("work/word-boundaries-report.json");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-arrangement-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 900),
  );
  // Keep animation frames running normally during native pointer drags.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  page.on("pageerror", (e) => errors.push(e.message));
  await app.evaluate(() => {
    const fetch = globalThis.fetch;
    const jobs = new Map();
    globalThis.sandboxTest = {
      requests: [],
      cancelled: [],
      prepared: [],
      delayed: false,
      release: null,
    };
    globalThis.fetch = async (...args) => {
      const url = String(args[0]),
        test = globalThis.sandboxTest;
      if (url.endsWith("/api/speech/voices"))
        return Response.json({
          voices: [
            { id: "default", name: "Chatterbox", kind: "builtin" },
            {
              id: "sapi-test",
              name: "System test",
              kind: "sapi",
              system: true,
            },
          ],
        });
      if (url.endsWith("/api/speech/prepare")) {
        test.prepared.push(JSON.parse(args[1].body).voiceId);
        return Response.json({ ready: true });
      }
      if (
        /\/api\/projects\/[^/]+\/speech$/.test(url) &&
        args[1]?.method === "POST"
      ) {
        const body = JSON.parse(args[1].body);
        test.requests.push(body);
        const id = `sandbox-test-${test.requests.length}`;
        const job = {
          id,
          status: "ready",
          eventSequence: 1,
          text: body.text,
          settings: { pauseSeconds: 0 },
          chunks: [
            {
              id: `${id}-chunk`,
              voiceId: body.voiceId,
              text: body.text,
              spokenText: body.text,
              sourceStart: 0,
              sourceEnd: body.text.length,
              seconds: 4,
              status: "ready",
              playbackEligible: true,
              audioUrl: `/api/speech/jobs/${id}/chunks/audio.wav`,
              wordTimings: [...body.text.matchAll(/\S+/g)].map((match, i) => ({
                text: match[0],
                sourceStart: match.index,
                sourceEnd: match.index + match[0].length,
                startSeconds: i * 0.06,
                endSeconds: (i + 1) * 0.06,
              })),
            },
          ],
        };
        jobs.set(id, job);
        if (test.delayed) {
          test.delayed = false;
          await new Promise((resolve) => {
            test.release = resolve;
          });
        }
        return Response.json(job);
      }
      const id = url.match(/\/api\/speech\/jobs\/(sandbox-test-\d+)/)?.[1];
      if (id) {
        const job = jobs.get(id);
        if (url.includes("/chunks/")) {
          const samples = 8000 * 4,
            wav = Buffer.alloc(44 + samples * 2);
          wav.write("RIFF");
          wav.writeUInt32LE(wav.length - 8, 4);
          wav.write("WAVEfmt ", 8);
          wav.writeUInt32LE(16, 16);
          wav.writeUInt16LE(1, 20);
          wav.writeUInt16LE(1, 22);
          wav.writeUInt32LE(8000, 24);
          wav.writeUInt32LE(16000, 28);
          wav.writeUInt16LE(2, 32);
          wav.writeUInt16LE(16, 34);
          wav.write("data", 36);
          wav.writeUInt32LE(samples * 2, 40);
          return new Response(wav, {
            headers: { "Content-Type": "audio/wav" },
          });
        }
        if (url.includes("/events")) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return Response.json({ sequence: 1, snapshot: job });
        }
        if (url.endsWith("/cancel")) test.cancelled.push(id);
        if (url.endsWith("/demand")) return Response.json({ ok: true });
        return Response.json(job);
      }
      return fetch(...args);
    };
  });
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const write = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });

  const words = Array.from({ length: 24 }, (_, i) => `word${i}`);
  const outcomes = [];
  await expect(page.getByText("Follow text", { exact: true })).toHaveCount(0);
  for (const voice of ["default", "sapi-test"]) {
    await write.fill(words.join(" "));
    await write.press("ControlOrMeta+Home");
    await page.getByLabel("Reading voice", { exact: true }).selectOption(voice);
    await page
      .getByRole("spinbutton", { name: "Reading speed", exact: true })
      .fill("3");
    await page
      .getByRole("spinbutton", { name: "Reading speed", exact: true })
      .blur();
    await page.waitForTimeout(1000);
    await expect(write).toHaveText(words.join(" "));
    await page.evaluate(() => {
      window.seenWords = [];
      window.wordObserver?.disconnect();
      const editor = document.querySelector(
        '[aria-label="Chapter text editor"]',
      );
      window.wordObserver = new MutationObserver(() => {
        const word = [
          ...document.querySelectorAll(
            '[aria-label="Chapter text editor"] .reading-word',
          ),
        ]
          .map((el) => el.textContent)
          .join("");
        if (word && window.seenWords.at(-1) !== word)
          window.seenWords.push(word);
      });
      window.wordObserver.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    });
    await write.press("ControlOrMeta+A");
    await page
      .getByRole("button", { name: "Play Reading", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.seenWords.includes("word23")))
      .toBe(true);
    const seen = await page.evaluate(() => window.seenWords);
    expect(seen).toEqual(words);
    await page
      .getByRole("button", { name: "Stop reading", exact: true })
      .click();
    await expect(write.locator(".reading-word")).toHaveCount(0);
    outcomes.push({ voice, words: seen.length, speed: 3, wordDurationMs: 20 });
  }
  await write.press("ControlOrMeta+A");
  await write.evaluate((el) => {
    const data = new DataTransfer();
    data.setData(
      "text/html",
      '<p>Before (<a href="https://example.com/long-url">Wikipedia</a>) after</p>',
    );
    data.setData("text/plain", "Before (Wikipedia) after");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(write).toHaveText("Before (Wikipedia) after");
  await write.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Play Reading", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(() => globalThis.sandboxTest.requests.at(-1)?.text),
    )
    .toBe("Before after");
  await page.getByRole("button", { name: "Stop reading", exact: true }).click();
  await page.evaluate(() => {
    localStorage.setItem("alder.readReferences", "true");
    window.dispatchEvent(new Event("alder-preference-changed"));
  });
  await write.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Play Reading", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(() => globalThis.sandboxTest.requests.at(-1)?.text),
    )
    .toBe("Before (Wikipedia) after");
  await page.getByRole("button", { name: "Stop reading", exact: true }).click();
  const referenceText =
    "Before ([PubMed Central (PMC)][2]), after [7]. Finally (see [Reuters][8]).";
  await write.fill(referenceText);
  await page.evaluate(() => {
    localStorage.setItem("alder.readReferences", "false");
    window.dispatchEvent(new Event("alder-preference-changed"));
  });
  await write.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Play Reading", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(() => globalThis.sandboxTest.requests.at(-1)?.text),
    )
    .toBe("Before, after. Finally.");
  await page.getByRole("button", { name: "Stop reading", exact: true }).click();
  await page.evaluate(() => {
    localStorage.setItem("alder.readReferences", "true");
    window.dispatchEvent(new Event("alder-preference-changed"));
  });
  await write.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Play Reading", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(() => globalThis.sandboxTest.requests.at(-1)?.text),
    )
    .toBe(referenceText);
  await page.getByRole("button", { name: "Stop reading", exact: true }).click();
  expect(errors).toEqual([]);
  fs.writeFileSync(report, JSON.stringify({ status: "passed", outcomes }));
} catch (error) {
  fs.writeFileSync(
    report,
    JSON.stringify({
      status: "failed",
      error: error.stack,
      errors,
      seen: await (
        await app.firstWindow()
      ).evaluate(() => ({
        words: window.seenWords,
        text: document.querySelector('[aria-label="Chapter text editor"]')
          ?.textContent,
        reader: document.querySelector(".document-reader")?.textContent,
        audio: [...document.querySelectorAll("audio")].map((a) => ({
          time: a.currentTime,
          paused: a.paused,
          src: a.src,
        })),
        errors: window.errors,
      })),
      requests: await app.evaluate(() => globalThis.sandboxTest.requests),
    }),
  );
  throw error;
} finally {
  await app.close();
}
