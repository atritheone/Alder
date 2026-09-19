import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-buffer-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1280, 900);
    window.showInactive();
  });
  await app.evaluate(() => {
    const fetch = globalThis.fetch;
    globalThis.bufferTest = {
      ready: false,
      sequence: 0,
      demands: [],
      submissions: 0,
    };
    let job;
    globalThis.fetch = async (...args) => {
      const url = String(args[0]),
        state = globalThis.bufferTest;
      if (url.endsWith("/api/analyze")) {
        const text = JSON.parse(args[1].body).text;
        globalThis.bufferTest.analyzedText = text;
        return Response.json({
          words: 4,
          sentences: 1,
          annotations: [
            {
              id: "spelling-test",
              type: "spelling",
              start: 0,
              end: 5,
              message: "Spelling",
              rule: "spelling",
            },
            {
              id: "grammar-test",
              type: "style",
              start: 6,
              end: 10,
              message: "Grammar",
              rule: "repetition",
            },
          ],
        });
      }
      if (url.endsWith("/api/speech/prepare"))
        return Response.json({ ready: true });
      if (
        /\/api\/projects\/[^/]+\/speech$/.test(url) &&
        args[1]?.method === "POST"
      ) {
        const body = JSON.parse(args[1].body);
        state.submissions++;
        job = {
          id: "buffer-test",
          status: "queued",
          eventSequence: 0,
          text: body.text,
          progress: 0.5,
          strictVerification: false,
          message: "Preparing",
          createdAt: new Date().toISOString(),
          settings: { pauseSeconds: 0 },
          chunks: [0, 1, 2, 3, 4, 5].map((i) => ({
            id: `chunk-${i}`,
            voiceId: "default",
            text: body.text,
            sourceStart: 0,
            sourceEnd: body.text.length,
            spokenText: body.text,
            seconds: 12,
            status: i === 0 ? "ready" : "queued",
            playbackEligible: i === 0,
            verificationStatus: i === 0 ? "warning" : "pending",
            audioUrl:
              i === 0
                ? "/api/speech/jobs/buffer-test/chunks/audio.wav"
                : undefined,
            wordTimings: [],
          })),
        };
        return Response.json(job);
      }
      if (url.includes("/api/speech/jobs/buffer-test/chunks/")) {
        const samples = 8000 * 12,
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
        return new Response(wav, { headers: { "Content-Type": "audio/wav" } });
      }
      if (url.includes("/api/speech/jobs/buffer-test")) {
        if (url.endsWith("/demand")) {
          state.demands.push(JSON.parse(args[1].body).mode);
          return Response.json({ ok: true });
        }
        if (url.includes("/events")) {
          await new Promise((r) => setTimeout(r, 100));
          if (state.ready) {
            job.status = "buffered";
            job.eventSequence = 1;
            Object.assign(job.chunks[1], {
              status: "ready",
              playbackEligible: true,
              audioUrl: "/api/speech/jobs/buffer-test/chunks/audio.wav",
            });
            return Response.json({ sequence: 1, snapshot: job });
          }
          return Response.json({ sequence: 0, events: [] });
        }
        return Response.json(job);
      }
      return fetch(...args);
    };
  });
  const samples = 8000 * 12,
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
  await page.route("**/api/speech/jobs/buffer-test/chunks/**", (r) =>
    r.fulfill({ contentType: "audio/wav", body: wav }),
  );
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const sandboxToggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await sandboxToggle.getAttribute("aria-expanded")) === "false")
    await sandboxToggle.click();
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Sandbox", exact: true })
    .click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await sandbox.fill("Sandbox text for checking.");
  await expect(sandbox.locator(".annotation-spelling")).toHaveCount(1);
  await expect(sandbox.locator(".annotation-grammar")).toHaveCount(1);
  await editor.fill(
    "Alder reads this passage without waiting between its sections.",
  );
  await expect(
    page
      .getByLabel("Reading voice", { exact: true })
      .locator("option[value=default]"),
  ).toHaveCount(1);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await expect(editor.locator(".annotation-spelling")).toHaveCount(1);
  await expect(editor.locator(".annotation-grammar")).toHaveCount(1);
  await editor.press("Control+Home");
  await page.getByRole("button", { name: "Play Reading", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Loading Reading", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      app.evaluate(() => globalThis.bufferTest.demands.includes("buffering")),
    )
    .toBe(true);
  await expect(page.locator(".reading-warning")).toHaveCount(0);
  await expect(editor.locator(".annotation")).toHaveCount(0);
  const audio = page.locator(".document-reader:not(.sandbox-reader) audio");
  await expect.poll(() => audio.evaluate((a) => a.currentTime)).toBe(0);
  await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(true);
  // Pause the wait, finish rendering, and prove audio still needs a user resume.
  await page
    .getByRole("button", { name: "Loading Reading", exact: true })
    .click();
  await app.evaluate(() => {
    globalThis.bufferTest.ready = true;
  });
  await expect(
    page.getByRole("button", { name: "Play Reading", exact: true }),
  ).toBeVisible();
  await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(true);
  await page.getByRole("button", { name: "Play Reading", exact: true }).click();
  await expect
    .poll(() => audio.evaluate((a) => a.currentTime))
    .toBeGreaterThan(0.1);
  await expect(editor.locator(".annotation")).toHaveCount(0);
  await sandbox.focus();
  await expect
    .poll(() => app.evaluate(() => globalThis.bufferTest.analyzedText))
    .toBe("Sandbox text for checking.");
  await expect(sandbox.locator(".annotation")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Pause Reading", exact: true })
    .click();
  await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(true);
  await sandbox.focus();
  await expect(sandbox.locator(".annotation-spelling")).toHaveCount(1);
  await expect(sandbox.locator(".annotation-grammar")).toHaveCount(1);
  await editor.focus();
  await expect(editor.locator(".annotation-spelling")).toHaveCount(1);
  await expect(editor.locator(".annotation-grammar")).toHaveCount(1);
  await page.getByRole("button", { name: "Play Reading", exact: true }).click();
  await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(false);
  await page.getByRole("button", { name: "Stop reading", exact: true }).click();
  await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(true);
  await expect(editor.locator(".annotation-spelling")).toHaveCount(1);
  await expect(editor.locator(".annotation-grammar")).toHaveCount(1);
  console.log("Checks: playback suppression and restoration passed");
  const opened = await app.evaluate(({ Menu, BrowserWindow }) => {
    const visit = (menu) => {
      for (const item of menu?.items || []) {
        if (item.label.toLowerCase() === "narration queue") {
          item.click(item, BrowserWindow.getAllWindows()[0]);
          return true;
        }
        if (item.submenu && visit(item.submenu)) return true;
      }
      return false;
    };
    return visit(Menu.getApplicationMenu());
  });
  expect(opened).toBe(true);
  await page.getByText("Speech options", { exact: true }).click();
  const strict = page.getByRole("checkbox", {
    name: "Strict wording verification",
    exact: true,
  });
  await expect(strict).not.toBeChecked();
  await strict.check();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const saved = await page.evaluate(async () =>
    window.alder.request(
      "GET",
      `/api/projects/${localStorage.getItem("alder.project")}`,
    ),
  );
  expect(saved.settings.speechOptions.strictVerification).toBe(true);
  await strict.uncheck();
  console.log(
    JSON.stringify({ ok: true, buffering: true, pauseAndResume: true }),
  );
} catch (error) {
  console.log(await app.evaluate(() => globalThis.bufferTest));
  const p = await app.firstWindow();
  console.log(
    await p.locator(".document-reader:not(.sandbox-reader)").evaluate((e) => ({
      text: e.textContent,
      audio: [...e.querySelectorAll("audio")].map((a) => ({
        src: a.src,
        paused: a.paused,
        ready: a.readyState,
        error: a.error?.message,
      })),
    })),
  );
  throw error;
} finally {
  await app.close();
}
