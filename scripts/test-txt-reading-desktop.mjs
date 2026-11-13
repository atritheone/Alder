// Targeted TXT player/publication integration; deterministic audio avoids model generation.
import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "alder-txt-reading-"));
const report = { status: "running", checks: [], errors: [] };
let app;
const wav = Buffer.alloc(44 + 8000 * 10 * 2);
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
wav.writeUInt32LE(wav.length - 44, 40);
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [
      ".",
      "--headless-test",
      `--user-data-dir=${path.join(profile, "profile")}`,
    ],
    env: {
      ...process.env,
      ALDER_DATA_DIR: path.join(profile, "data"),
      ALDER_RESOURCES_DIR: path.resolve("work/bundle-resources"),
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await app.evaluate((_electron, audioBytes) => {
    const original = globalThis.fetch;
    let job;
    globalThis.fetch = async (...args) => {
      const url = String(args[0]);
      if (url.endsWith("/api/speech/jobs/txt-reading-fixture/chunks/chunk.wav"))
        return new Response(Uint8Array.from(audioBytes), {
          headers: { "Content-Type": "audio/wav" },
        });
      if (url.endsWith("/api/speech/prepare"))
        return Response.json({ ready: true });
      if (
        /\/api\/projects\/[^/]+\/speech$/.test(url) &&
        args[1]?.method === "POST"
      ) {
        const body = JSON.parse(args[1].body),
          start = Array.from(
            body.text.slice(0, body.text.indexOf("Second")),
          ).length;
        job = {
          id: "txt-reading-fixture",
          projectId: url.split("/").at(-2),
          status: "ready",
          text: body.text,
          sourceRevision: 1,
          progress: 1,
          message: "Ready",
          createdAt: new Date().toISOString(),
          seconds: 10,
          eventSequence: 0,
          settings: { pauseSeconds: 0 },
          chunks: [
            {
              id: "chunk",
              text: body.text,
              status: "ready",
              playbackEligible: true,
              sourceStart: 0,
              sourceEnd: Array.from(body.text).length,
              seconds: 10,
              startSeconds: 0,
              audioUrl: "/api/speech/jobs/txt-reading-fixture/chunks/chunk.wav",
              wordTimings: [
                {
                  text: "Second",
                  sourceStart: start,
                  sourceEnd: start + 6,
                  startSeconds: 0,
                  endSeconds: 10,
                },
              ],
            },
          ],
        };
        return Response.json(job);
      }
      if (url.includes("/api/speech/jobs/txt-reading-fixture")) {
        if (url.includes("/events"))
          return Response.json({ sequence: 0, events: [] });
        return Response.json(job);
      }
      return original(...args);
    };
  }, Array.from(wav));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "TXT text editor",
    exact: true,
  });
  await editor.fill("A😀 café before.\nSecond paragraph retains its wording.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await editor.press("Control+Home");
  const reader = page.locator(".document-reader");
  await reader
    .getByRole("button", { name: "Play Reading", exact: true })
    .click();
  await expect
    .poll(() => reader.locator("audio").evaluate((audio) => audio.paused))
    .toBe(false);
  await expect(editor.locator(".txt-reading")).toHaveText("Second");
  await reader
    .getByRole("button", { name: "Pause Reading", exact: true })
    .click();
  await expect(editor).toHaveText(
    "A😀 café before.Second paragraph retains its wording.",
  );
  await reader
    .getByRole("button", { name: "Stop reading", exact: true })
    .click();
  await expect(editor.locator(".txt-reading")).toHaveCount(0);
  report.checks.push(
    "TXT audio highlight uses correct offsets after emoji; pause/stop retain text",
  );
  const result = await page.evaluate(async () =>
    window.alder.request(
      "POST",
      `/api/projects/${localStorage.getItem("alder.project")}/export`,
      { format: "pdf" },
    ),
  );
  const bytes = await page.evaluate(
    async (url) =>
      Array.from(
        new Uint8Array(
          await (await fetch(window.alder.mediaBase + url)).arrayBuffer(),
        ),
      ),
    result.downloadUrl,
  );
  expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
  report.checks.push(
    "TXT PDF publication remains available through existing layout",
  );
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.errors.push(error.stack || String(error));
  if (app) {
    const page = app.windows()[0];
    report.debug = await page
      .evaluate(() => ({
        reader: document.querySelector(".document-reader")?.textContent,
        highlights: document.querySelectorAll(".txt-reading").length,
        text: document.querySelector(".cm-content")?.textContent,
      }))
      .catch(() => null);
  }
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  const output = path.join(os.tmpdir(), "alder-txt-reading-report.json");
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: output }, null, 2));
  if (
    path.dirname(profile) === path.resolve(os.tmpdir()) &&
    path.basename(profile).startsWith("alder-txt-reading-")
  )
    await fs.rm(profile, { recursive: true, force: true });
}
