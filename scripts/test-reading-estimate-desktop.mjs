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
const report = path.resolve("work/reading-estimate-report.json");
fs.mkdirSync(path.dirname(report), { recursive: true });
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
              seconds: 40,
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
        if (body.text.includes("w900")) {
          const offset = body.text.indexOf("w900");
          job.chunks[0].wordTimings = [
            {
              text: "w0",
              sourceStart: 0,
              sourceEnd: 2,
              startSeconds: 0,
              endSeconds: 15,
            },
            {
              text: "w900",
              sourceStart: offset,
              sourceEnd: offset + 4,
              startSeconds: 15,
              endSeconds: 39,
            },
          ];
        }
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
          const samples = 8000 * 40,
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
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const text = Array.from({ length: 60 }, (_, row) =>
    Array.from({ length: 18 }, (_, col) => `w${row * 18 + col}`).join(" "),
  ).join("\n");
  const sandboxToggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await sandboxToggle.getAttribute("aria-expanded")) === "false")
    await sandboxToggle.click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await expect(
    page.getByRole("combobox", { name: "Draft voice", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Sandbox voice", exact: true }),
  ).toBeVisible();
  await sandbox.fill("Draft one. Draft two!");
  const draftWords = page
    .locator(".clip-properties .property-grid label")
    .filter({ hasText: "Words" })
    .locator("output");
  const draftSentences = page
    .locator(".clip-properties .property-grid label")
    .filter({ hasText: "Sentences" })
    .locator("output");
  await expect(draftWords).toHaveText("4");
  await expect(draftSentences).toHaveText("2");
  await page.waitForTimeout(300);
  await sandbox.press("ControlOrMeta+Home");
  await sandbox.press("ControlOrMeta+Shift+ArrowRight");
  await expect(draftWords).toHaveText("1");
  await expect(draftSentences).toHaveText("1");
  await editor.fill("Write has one sentence.");
  await expect(page.locator(".writing-sentence-count")).toHaveText(
    "1 Sentences",
  );
  await editor.fill("Write has one sentence. Now another! Third sentence?");
  await expect(page.locator(".writing-sentence-count")).toHaveText(
    "3 Sentences",
  );
  await expect(draftWords).toHaveText("4");
  await expect(draftSentences).toHaveText("2");
  await sandbox.focus();
  await expect(draftWords).toHaveText("1");
  await expect(draftSentences).toHaveText("1");
  await sandbox.press("ArrowRight");
  await expect(draftWords).toHaveText("4");
  await expect(draftSentences).toHaveText("2");
  await page
    .getByRole("button", { name: "New sandbox draft", exact: true })
    .click();
  await expect(draftWords).toHaveText("0");
  await expect(draftSentences).toHaveText("0");
  await sandbox.fill("Draft one. Draft two!");
  await expect(draftWords).toHaveText("4");
  await expect(draftSentences).toHaveText("2");
  const actions = await page.locator(".sandbox-draft-actions").boundingBox();
  const versions = await page
    .getByRole("combobox", { name: "Draft version", exact: true })
    .boundingBox();
  expect(versions.x - (actions.x + actions.width)).toBeLessThan(20);
  expect(versions.x).toBeGreaterThan(actions.x);
  await editor.fill(text);
  const estimate = page.locator(".reading-estimate");
  const count = page.locator(".writing-word-count");
  await expect(count).toHaveText("1080 Words");
  await expect(estimate).toHaveText("≈ 0:06");
  const barHeight = () =>
    page
      .locator(".page-navigation")
      .evaluate((el) => el.getBoundingClientRect().height);
  const defaultHeight = await barHeight();
  const speed = page.getByRole("spinbutton", {
    name: "Reading speed",
    exact: true,
  });
  await speed.fill("2");
  await speed.press("Enter");
  await expect(estimate).toHaveText("≈ 0:03");
  await speed.fill("1");
  await speed.press("Enter");
  await editor.focus();
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("spinbutton", { name: "Go To Page" })
          .getAttribute("max"),
      ),
    )
    .toBeGreaterThan(1);
  const pageCount = Number(
    await page
      .getByRole("spinbutton", { name: "Go To Page" })
      .getAttribute("max"),
  );
  await editor.press("ControlOrMeta+A");
  await expect(page.locator(".selection-page-count")).toHaveText(
    `${pageCount} Pages`,
  );
  await expect(count).toHaveText("1080 Words");
  // Let ProseMirror finish its native focus/selection restoration window.
  await page.waitForTimeout(300);
  await editor.evaluate((el) => {
    el.focus();
    const selection = document.getSelection();
    selection.collapse(el.querySelector("p").firstChild, 0);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.locator(".selection-page-count")).toHaveCount(0);
  // Select a word, then several paragraphs spanning physical pages.
  await editor.press("Shift+ArrowRight");
  await editor.press("Shift+ArrowRight");
  await expect(count).toHaveText("1 Words");
  await expect(page.locator(".writing-sentence-count")).toHaveText(
    "1 Sentences",
  );
  await expect(draftWords).toHaveText("4");
  await expect(draftSentences).toHaveText("2");
  expect(await barHeight()).toBe(defaultHeight);
  await expect(page.locator(".status-project-count")).toHaveText("1 words");
  await expect(page.locator(".selection-page-count")).toHaveText("1 Page");
  await expect(estimate).toHaveText("≈ 0:01");
  // Let ProseMirror finish its native focus/selection restoration window.
  await page.waitForTimeout(300);
  await editor.evaluate((el) => {
    const paragraphs = el.querySelectorAll("p");
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(paragraphs[10].firstChild, 0);
    range.setEnd(paragraphs[29].firstChild, paragraphs[29].textContent.length);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(count).toHaveText("360 Words");
  await expect(estimate).toHaveText("≈ 0:02");
  expect(await barHeight()).toBe(defaultHeight);
  await speed.fill("2");
  await speed.press("Enter");
  await expect(estimate).toHaveText("≈ 0:01");
  await speed.fill("1");
  await speed.press("Enter");
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await expect(count).toHaveText("360 Words");
  await expect
    .poll(async () =>
      Number(
        (await page.locator(".selection-page-count").textContent()).split(
          " ",
        )[0],
      ),
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "Play Reading", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause Reading", exact: true }),
  ).toBeVisible();
  await expect(estimate).toHaveAttribute(
    "title",
    /time remaining for selection/,
  );
  await expect(estimate).toHaveText("≈ 0:02");
  await page
    .locator(".document-reader:not(.sandbox-reader) audio")
    .evaluate((a) => {
      a.currentTime = 5;
    });
  await expect(estimate).toHaveText("≈ 0:00");
  await expect(count).toHaveText("360 Words");
  await page.getByRole("button", { name: "Stop reading", exact: true }).click();
  await expect(estimate).toHaveText("≈ 0:06");
  // Let ProseMirror finish its native focus/selection restoration window.
  await page.waitForTimeout(300);
  await editor.evaluate((el) => {
    el.focus();
    const selection = document.getSelection();
    selection.collapse(el.querySelector("p").firstChild, 0);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.getByRole("button", { name: "Play Reading", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause Reading", exact: true }),
  ).toBeVisible();
  const audio = page.locator(".document-reader:not(.sandbox-reader) audio");
  await expect(estimate).toHaveAttribute(
    "title",
    /time remaining for document/,
  );
  await audio.evaluate((a) => {
    a.currentTime = 20;
  });
  await expect(estimate).toHaveText("≈ 0:01");
  await expect(count).toHaveText("1080 Words");
  await page
    .getByRole("button", { name: "Pause Reading", exact: true })
    .click();
  await expect(estimate).toHaveText("≈ 0:06");
  await expect(estimate).toHaveAttribute("title", /reading time for document/);
  expect(await barHeight()).toBe(defaultHeight);
  await speed.fill("2");
  await speed.press("Enter");
  await expect(estimate).toHaveText("≈ 0:03");
  await page.getByRole("button", { name: "Stop reading", exact: true }).click();
  expect(errors).toEqual([]);
  fs.writeFileSync(
    report,
    JSON.stringify(
      {
        status: "passed",
        checks:
          "Full/partial selections, selected page coverage and word counts, whole-document estimate, remaining playback estimate, pause restores total estimate",
      },
      null,
      2,
    ),
  );
} catch (error) {
  fs.writeFileSync(
    report,
    JSON.stringify(
      {
        status: "failed",
        error: error.stack,
        debug: await (
          await app.firstWindow()
        ).evaluate(() => {
          const el = document.querySelector(
            '[aria-label="Chapter text editor"]',
          );
          const sel = document.getSelection();
          return {
            active: document.activeElement?.getAttribute("aria-label"),
            selected: sel?.toString().slice(0, 40),
            anchor: sel?.anchorOffset,
            from: el?.pmViewDesc?.view?.state.selection.from,
            to: el?.pmViewDesc?.view?.state.selection.to,
            count: document.querySelector(".writing-word-count")?.textContent,
          };
        }),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app.close();
}
