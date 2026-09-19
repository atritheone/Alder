import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-arrangement-"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
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
  const errors = [];
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
              wordTimings: [
                {
                  text: body.text.split(" ")[0],
                  sourceStart: 0,
                  sourceEnd: body.text.split(" ")[0].length,
                  startSeconds: 0,
                  endSeconds: 3.8,
                },
              ],
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
  await write.fill("Writing remains unchanged.");
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
  const controls = page.locator(".detail-pane .format-toolbar .sandbox-reader");
  await expect(controls).toBeVisible();
  const play = controls.getByRole("button", {
    name: "Play Sandbox",
    exact: true,
  });
  const stop = controls.getByRole("button", {
    name: "Stop Sandbox",
    exact: true,
  });
  const audio = controls.locator("audio");
  await sandbox.fill("First version for playback.");
  await sandbox.press("ControlOrMeta+End");
  await sandbox.press("ControlOrMeta+Enter");
  await expect
    .poll(() => audio.evaluate((a) => a.currentTime))
    .toBeGreaterThan(0.1);
  await expect(sandbox.locator(".reading-word")).toHaveText("First");
  expect(
    await app.evaluate(() => globalThis.sandboxTest.requests[0].text),
  ).toBe("First version for playback.");
  await sandbox.press("ControlOrMeta+Enter");
  await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(true);
  await play.click();
  await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(false);
  expect(await app.evaluate(() => globalThis.sandboxTest.requests.length)).toBe(
    1,
  );
  await sandbox.fill("Second version sounds different.");
  await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(true);
  await play.click();
  await expect
    .poll(() => audio.evaluate((a) => a.currentTime))
    .toBeGreaterThan(0.1);
  expect(
    await app.evaluate(() => globalThis.sandboxTest.requests.at(-1).text),
  ).toBe("Second version sounds different.");
  await stop.click();
  await expect.poll(() => audio.evaluate((a) => a.currentTime)).toBe(0);
  await play.click();
  await expect.poll(() => audio.evaluate((a) => a.paused)).toBe(false);
  expect(await app.evaluate(() => globalThis.sandboxTest.requests.length)).toBe(
    2,
  );
  await audio.evaluate((a) => {
    a.currentTime = 3.95;
  });
  await expect.poll(() => audio.evaluate((a) => a.ended)).toBe(true);
  await expect(play).toBeVisible();
  await play.click();
  await expect
    .poll(() => audio.evaluate((a) => !a.ended && !a.paused))
    .toBe(true);
  expect(await app.evaluate(() => globalThis.sandboxTest.requests.length)).toBe(
    2,
  );
  await stop.click();
  await app.evaluate(() => {
    globalThis.sandboxTest.delayed = true;
  });
  await sandbox.fill("Delayed old wording.");
  await play.click();
  await expect
    .poll(() => app.evaluate(() => globalThis.sandboxTest.requests.length))
    .toBe(3);
  await sandbox.fill("Latest wording wins.");
  await play.click();
  await expect
    .poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0.1))
    .toBe(true);
  expect(
    await app.evaluate(() => globalThis.sandboxTest.requests.at(-1).text),
  ).toBe("Latest wording wins.");
  await app.evaluate(() => globalThis.sandboxTest.release());
  await expect
    .poll(() =>
      app.evaluate(() =>
        globalThis.sandboxTest.cancelled.includes("sandbox-test-3"),
      ),
    )
    .toBe(true);
  await expect
    .poll(() => audio.evaluate((a) => a.src.includes("sandbox-test-4")))
    .toBe(true);
  await stop.click();
  const sapi = await page.evaluate(async () =>
    (await window.alder.request("GET", "/api/speech/voices")).voices.find(
      (v) => v.kind === "sapi",
    ),
  );
  if (sapi) {
    await controls
      .getByRole("combobox", { name: "Sandbox voice", exact: true })
      .selectOption(sapi.id);
    await play.click();
    await expect
      .poll(() => audio.evaluate((a) => !a.paused && a.currentTime > 0.1))
      .toBe(true);
    expect(
      await app.evaluate(() => globalThis.sandboxTest.requests.at(-1).voiceId),
    ).toBe(sapi.id);
    await stop.click();
  }
  await controls
    .getByRole("spinbutton", { name: "Sandbox speed", exact: true })
    .fill("1.5");
  await controls
    .getByRole("spinbutton", { name: "Sandbox speed", exact: true })
    .press("Enter");
  await expect.poll(() => audio.evaluate((a) => a.playbackRate)).toBe(1.5);
  expect(
    await page.evaluate(() => localStorage.getItem("alder.sandboxSpeed")),
  ).toBe("1.5");
  await expect(write).toHaveText("Writing remains unchanged.");
  await page
    .locator(".detail-pane")
    .screenshot({ path: path.resolve("work/sandbox-toolbar.png") });
  await page
    .getByRole("combobox", { name: "Draft voice", exact: true })
    .selectOption("default");
  await expect(
    controls.getByRole("combobox", { name: "Sandbox voice", exact: true }),
  ).toHaveValue("default");
  await play.click();
  await expect.poll(() => audio.evaluate((a) => !a.paused)).toBe(true);
  await audio.evaluate((element) => {
    window.closedSandboxAudio = element;
  });
  await toggle.click();
  await expect(controls).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.closedSandboxAudio.paused))
    .toBe(true);
  await toggle.click();
  await expect(controls).toBeVisible();
  await expect(play).toBeVisible();
  await expect(sandbox.locator(".reading-word")).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "Sandbox TTS checks passed: fresh wording, pause/resume, stop/replay, completed replay, stale request cancellation, voice selection, speed, highlighting and keyboard playback.",
  );
} finally {
  await app.close();
}
