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
const report = path.resolve("work/workspace-controls-report.json");
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
  const toggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  const select = async (editor, start, end) => {
    await editor.focus();
    await editor.evaluate(
      (el, [start, end]) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const nodes = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
        const point = (offset) => {
          for (const n of nodes) {
            if (offset <= n.length) return [n, offset];
            offset -= n.length;
          }
          return [el, 0];
        };
        const range = document.createRange();
        range.setStart(...point(start));
        range.setEnd(...point(end));
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      },
      [start, end],
    );
    await expect
      .poll(() =>
        editor.evaluate((el) => {
          const selection = document.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          range.setEnd(selection.anchorNode, selection.anchorOffset);
          return range.toString().length;
        }),
      )
      .toBe(start);
  };
  const requests = () => app.evaluate(() => globalThis.sandboxTest.requests);
  for (const [editor, playName, pauseName, stopName] of [
    [write, "Play Reading", "Pause Reading", "Stop reading"],
    [sandbox, "Play Sandbox", "Pause Sandbox", "Stop Sandbox"],
  ]) {
    await editor.fill("Alpha beta gamma.");
    await select(editor, 6, 10);
    const before = (await requests()).length;
    await page.getByRole("button", { name: playName, exact: true }).click();
    await expect.poll(async () => (await requests()).length).toBe(before + 1);
    expect((await requests()).at(-1).text).toBe("beta");
    await expect(
      page.getByRole("button", { name: pauseName, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: pauseName, exact: true }).click();
    await page.getByRole("button", { name: playName, exact: true }).click();
    await expect(
      page.getByRole("button", { name: pauseName, exact: true }),
    ).toBeVisible();
    expect((await requests()).length).toBe(before + 1);
    await page.getByRole("button", { name: stopName, exact: true }).click();
    // Same start, different selection end must not replay the old selection.
    await select(editor, 6, 16);
    await page.getByRole("button", { name: playName, exact: true }).click();
    await expect.poll(async () => (await requests()).length).toBe(before + 2);
    expect((await requests()).at(-1).text).toBe("beta gamma");
    await expect(
      page.getByRole("button", { name: pauseName, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: stopName, exact: true }).click();
    await select(editor, 6, 6);
    await page.getByRole("button", { name: playName, exact: true }).click();
    await expect.poll(async () => (await requests()).length).toBe(before + 3);
    expect((await requests()).at(-1).text).toBe(
      editor === write ? "beta gamma." : "Alpha beta gamma.",
    );
    await expect(
      page.getByRole("button", { name: pauseName, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: stopName, exact: true }).click();
  }
  await page
    .getByRole("button", { name: "Save sandbox draft", exact: true })
    .click();
  const savedDraft = await page.evaluate(async () => {
    const p = await window.alder.request(
      "GET",
      `/api/projects/${localStorage.getItem("alder.project")}`,
    );
    return p.clips.find((c) => c.text === "Alpha beta gamma.");
  });
  expect(savedDraft).toBeTruthy();
  await page
    .getByRole("button", { name: "New sandbox draft", exact: true })
    .click();
  await expect(sandbox).toHaveText("");
  await sandbox.fill("A separate draft.");
  await page
    .getByRole("button", { name: "Save sandbox draft", exact: true })
    .click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  expect(
    await page.evaluate(async () => {
      const p = await window.alder.request(
        "GET",
        `/api/projects/${localStorage.getItem("alder.project")}`,
      );
      return p.clips.map((c) => c.text);
    }),
  ).toEqual(expect.arrayContaining(["Alpha beta gamma.", "A separate draft."]));
  await page
    .getByRole("button", { name: "Delete sandbox draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(sandbox).toHaveText("Alpha beta gamma.");
  await expect(write).toHaveText("Alpha beta gamma.");
  const title = page.getByRole("textbox", { name: "Sandbox draft title" });
  await title.focus();
  await title.press("Tab");
  await expect(page.locator(".page-arranger")).toHaveCount(0);
  for (const editor of [write, sandbox]) {
    await select(editor, 0, 0);
    await editor.press("Tab");
    await expect(page.locator(".page-arranger")).toHaveCount(0);
    expect(await editor.textContent()).toBe("\tAlpha beta gamma.");
    await editor.fill("Alpha beta gamma.");
  }
  await page.getByRole("tab", { name: "Write", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".page-arranger")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(".page-arranger")).toHaveCount(0);
  await expect(write).toHaveText("Alpha beta gamma.");
  await write.fill(
    Array.from(
      { length: 120 },
      (_, i) => `Paragraph ${i}. First sentence. Another sentence to move.`,
    ).join("\n\n"),
  );
  await expect(page.locator(".reading-estimate")).toHaveText("≈ 0:06");
  await page.getByRole("tab", { name: "Write", exact: true }).focus();
  await page.keyboard.press("Tab");
  const cards = page.locator(".page-card");
  await expect.poll(() => cards.count()).toBeGreaterThan(2);
  const area = page.locator(".page-arranger");
  await area.evaluate((el) => {
    el.scrollTop = 100;
  });
  const original = await area.evaluate((el) => ({
    top: el.scrollTop,
    left: el.scrollLeft,
  }));
  await cards.nth(1).hover();
  const originalWidth = (
    await cards.nth(1).locator(".page-miniature").boundingBox()
  ).width;
  await page.mouse.wheel(0, -120);
  await expect(
    page.getByRole("dialog", { name: "Page 2 focused view" }),
  ).toBeVisible();
  await expect(
    page
      .locator(
        ".focused-page-sheet .arrangement-unit:not(.is-empty) > .unit-outline",
      )
      .first(),
  ).toBeVisible();
  const motion = page.locator(".focused-page-motion");
  const settledWidth = async () => {
    await motion.evaluate(async (el) => {
      await Promise.all(
        el.getAnimations().map((animation) => animation.finished),
      );
    });
    return (await motion.boundingBox()).width;
  };
  await expect(motion).toHaveAttribute("data-focus-progress", "0.08");
  const firstWidth = await settledWidth();
  expect(firstWidth).toBeGreaterThan(originalWidth);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
  await expect
    .poll(async () => Number(await motion.getAttribute("data-focus-progress")))
    .toBeCloseTo(0.48);
  const partialWidth = await settledWidth();
  expect(partialWidth).toBeGreaterThan(firstWidth);
  await page.screenshot({
    path: path.resolve("work/arrangement-partial-focus.png"),
  });
  for (let i = 0; i < 7; i++) await page.mouse.wheel(0, -120);
  await expect(motion).toHaveAttribute("data-focus-progress", "1");
  const fullWidth = await settledWidth();
  expect(fullWidth).toBeGreaterThan(partialWidth);
  await page.mouse.wheel(0, 120);
  await expect(motion).toHaveAttribute("data-focus-progress", "0.92");
  expect(await settledWidth()).toBeLessThan(fullWidth);
  await page.mouse.wheel(0, 1440);
  await expect(page.locator(".arrangement-page-focus")).toHaveCount(0);
  expect(
    await area.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft })),
  ).toEqual(original);
  expect(
    await page
      .locator(".statusbar")
      .evaluate(
        (el) =>
          getComputedStyle(el).backgroundColor ===
          getComputedStyle(el.parentElement).backgroundColor,
      ),
  ).toBe(true);
  expect(errors).toEqual([]);
  fs.writeFileSync(
    report,
    JSON.stringify(
      {
        status: "passed",
        checks:
          "Write/Sandbox selections and resume, changed selection, no-selection defaults, draft new/save/delete, Tab switching and field navigation, reading estimate, wheel page focus/restore, bottom bar",
      },
      null,
      2,
    ),
  );
} catch (error) {
  fs.writeFileSync(
    report,
    JSON.stringify({ status: "failed", error: error.stack }, null, 2),
  );
  throw error;
} finally {
  await app.close();
}
