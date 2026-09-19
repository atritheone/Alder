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
              wordTimings: [...body.text.matchAll(/\S+/g)].map((m, i) => ({
                text: m[0],
                sourceStart: m.index,
                sourceEnd: m.index + m[0].length,
                startSeconds: i * 0.35,
                endSeconds: i * 0.35 + 0.15,
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

  await write.waitFor();
  await page.evaluate(() => {
    window.highlightCalls = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.classList.contains("reading-ink"))
        window.highlightCalls.push({
          word: this.parentElement.querySelector(".reading-word")?.textContent,
          frames: args[0],
          color: getComputedStyle(this).backgroundColor,
        });
      return animate.apply(this, args);
    };
  });
  const sample = "Alpha bravo charlie delta echo foxtrot golf hotel india.";
  await write.fill(sample);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const checkPlayback = async (editor, name) => {
    await page.evaluate(() => {
      window.highlightCalls = [];
    });
    await editor.click();
    await editor.press("ControlOrMeta+Home");
    await page.waitForTimeout(100); // Let native selection reach ProseMirror.
    await page
      .getByRole("button", { name: `Play ${name}`, exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.highlightCalls.length))
      .toBeGreaterThanOrEqual(5);
    const calls = await page.evaluate(() => window.highlightCalls);
    expect(
      calls.every(
        (c) => sample.includes(c.word) && c.color === "rgb(229, 197, 154)",
      ),
    ).toBe(true);
    expect(
      calls.filter(
        (c) =>
          c.frames[0].transform &&
          c.frames[0].transform !== c.frames[1].transform,
      ).length,
    ).toBeGreaterThanOrEqual(4);
    await page
      .getByRole("button", {
        name: name === "Reading" ? "Stop reading" : "Stop Sandbox",
        exact: true,
      })
      .click();
    await expect(editor.locator(".reading-word")).toHaveCount(0);
    const overlay = editor.locator("..").locator(".reading-ink");
    await expect(overlay).toHaveCSS("opacity", "0");
    expect(await overlay.evaluate((e) => e.getAnimations().length)).toBe(0);
    return calls.length;
  };
  const writeHandovers = await checkPlayback(write, "Reading");
  const sapi = await page.evaluate(async () =>
    (await window.alder.request("GET", "/api/speech/voices")).voices.find(
      (v) => v.kind === "sapi",
    ),
  );
  let sapiHandovers = null;
  if (sapi) {
    await page
      .getByLabel("Reading voice", { exact: true })
      .selectOption(sapi.id);
    sapiHandovers = await checkPlayback(write, "Reading");
  }
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
  await sandbox.fill(sample);
  const sandboxHandovers = await checkPlayback(sandbox, "Sandbox");
  expect(errors).toEqual([]);
  console.log("Real editor/audio highlight integration passed:", {
    writeHandovers,
    sapiHandovers,
    sandboxHandovers,
  });
} catch (error) {
  console.log(await app.evaluate(() => globalThis.sandboxTest));
  console.log(
    await (await app.firstWindow()).evaluate(() => window.highlightCalls),
  );
  throw error;
} finally {
  await app.close();
}
