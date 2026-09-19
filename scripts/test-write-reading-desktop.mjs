import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect as baseExpect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readingPerformance } from "./reading-performance.mjs";
const expect = baseExpect.configure({ timeout: 30000 });

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-write-reading-"));
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  // Deterministic alignment and audio test the player without synthesizing a book.
  await app.evaluate(() => {
    const request = globalThis.fetch;
    let job;
    globalThis.fetch = async (...args) => {
      const url = String(args[0]);
      if (url.endsWith("/api/speech/prepare"))
        return Response.json({ ready: true });
      if (url.endsWith("/api/analyze"))
        return Response.json({
          annotations: [
            {
              id: "spelling",
              type: "spelling",
              start: 0,
              end: 9,
              message: "Test spelling",
              rule: "test",
            },
            {
              id: "repetition",
              type: "repetition",
              start: 16,
              end: 21,
              message: "Test repetition",
              rule: "test",
            },
          ],
          words: 1,
          sentences: 1,
          readingSeconds: 1,
        });
      if (
        /\/api\/projects\/[^/]+\/speech$/.test(url) &&
        args[1]?.method === "POST"
      ) {
        const body = JSON.parse(args[1].body);
        const starts = [80, 100].map((n) =>
          body.text.indexOf(`Paragraph ${n}.`),
        );
        if (starts.some((start) => start < 0))
          throw new Error("Missing reading fixture");
        job = {
          id: "write-status",
          projectId: url.split("/").at(-2),
          status: "ready",
          text: body.text,
          sourceRevision: 1,
          progress: 1,
          message: "Ready",
          createdAt: new Date().toISOString(),
          seconds: 40,
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
              seconds: 40,
              startSeconds: 0,
              audioUrl: "/api/speech/jobs/write-status/chunks/chunk.wav",
              wordTimings: starts.map((start, index) => ({
                text: "Paragraph",
                sourceStart: Array.from(body.text.slice(0, start)).length,
                sourceEnd: Array.from(body.text.slice(0, start + 9)).length,
                startSeconds: index * 20,
                endSeconds: (index + 1) * 20,
              })),
            },
          ],
        };
        return Response.json(job);
      }
      if (url.includes("/api/speech/jobs/write-status")) {
        if (url.includes("/events")) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return Response.json({ sequence: 0, events: [] });
        }
        return Response.json(job);
      }
      return request(...args);
    };
  });
  const samples = 8000 * 40;
  const wav = Buffer.alloc(44 + samples * 2);
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
  await page.route("**/api/speech/jobs/write-status/chunks/**", (route) =>
    route.fulfill({ contentType: "audio/wav", body: wav }),
  );
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.getByRole("button", { name: "Justify", exact: true }).click();
  await expect(editor.locator("p").first()).toHaveCSS("text-align", "justify");
  await page.getByRole("button", { name: "Align left", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const name = await page.evaluate(
    async (paragraphCount) => {
      const id = localStorage.getItem("alder.project");
      const project = await window.alder.request("GET", `/api/projects/${id}`);
      project.book.chapters[0].document = {
        type: "doc",
        content: Array.from({ length: paragraphCount }, (_, i) => ({
          type: "paragraph",
          content: [
            {
              type: "text",
              text:
                `Paragraph ${i}. 🌲 ` +
                "Words retain their exact wrapping and page boundaries. ".repeat(
                  24,
                ),
            },
          ],
        })),
      };
      await window.alder.request("PUT", `/api/projects/${id}`, {
        expectedRevision: project.revision,
        project,
      });
      return project.name;
    },
    process.env.ALDER_READING_PERFORMANCE ? 300 : 120,
  );
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).first().click();
  await expect(editor).toContainText("Paragraph 119.");
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.locator(".book-editor .page-sheet").count())
    .toBeGreaterThan(40);
  await expect(page.locator(".save-status")).toHaveText("Saved");

  const caretResults = [];
  for (const zoom of process.env.ALDER_READING_PERFORMANCE
    ? []
    : ["0.5", "0.8", "1.15", "1.5"]) {
    await page.getByLabel("Page zoom", { exact: true }).selectOption(zoom);
    for (const paragraph of [0, 60, 119]) {
      const block = editor
        .locator("p")
        .filter({ hasText: `Paragraph ${paragraph}.` })
        .first();
      await block.scrollIntoViewIfNeeded();
      await block.evaluate((element) => {
        const editor = element.closest("[contenteditable]");
        editor.focus({ preventScroll: true });
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.textContent.length < 50) continue;
          const range = document.createRange();
          range.setStart(node, 40);
          range.collapse(true);
          const selection = document.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
          break;
        }
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const range = document
              .getSelection()
              .getRangeAt(0)
              .getBoundingClientRect();
            const caret = document
              .querySelector(".book-editor .write-caret")
              .getBoundingClientRect();
            return Math.max(
              Math.abs(caret.top - range.top),
              Math.abs(caret.left - range.left),
              Math.abs(caret.height - range.height),
            );
          }),
        )
        .toBeLessThan(1);
      caretResults.push({ zoom, paragraph });
    }
  }
  await page.getByLabel("Page zoom", { exact: true }).selectOption("0.8");
  await editor.focus();
  await editor.press("Control+Home");
  // Persist schema-normalized attributes before obtaining canonical text.
  await editor.press("Space");
  await editor.press("Backspace");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await expect(editor.locator(".annotation-spelling")).toHaveCount(1);
  const expected = await page.evaluate(async () => {
    const project = await window.alder.request(
      "GET",
      `/api/projects/${localStorage.getItem("alder.project")}`,
    );
    const text = project.book.chapters[0].text;
    const sheets = Array.from(
      document.querySelectorAll(".book-editor .page-sheet"),
    );
    return [80, 100].map((number) => {
      const p = Array.from(
        document.querySelectorAll(".book-editor .ProseMirror p"),
      ).find((p) => p.textContent.startsWith(`Paragraph ${number}.`));
      const range = document.createRange();
      range.setStart(p.firstChild, 0);
      range.collapse(true);
      const y = range.getBoundingClientRect().top;
      const index = sheets.findIndex((sheet) => {
        const rect = sheet.getBoundingClientRect();
        return y >= rect.top && y < rect.bottom;
      });
      if (index < 0) throw new Error("Spoken text is outside physical pages");
      return {
        page: String(index + 1),
        progress: `${((100 * text.indexOf(`Paragraph ${number}.`)) / text.length).toFixed(0)}%`,
      };
    });
  });
  const reader = page.locator(".document-reader");
  if (process.env.ALDER_READING_PERFORMANCE) {
    await readingPerformance(app, page, editor);
  } else {
    await reader.getByLabel("Follow text", { exact: true }).uncheck();
    await reader
      .getByRole("button", { name: "Play Reading", exact: true })
      .click();
    await expect
      .poll(() => reader.locator("audio").evaluate((audio) => audio.paused))
      .toBe(false);
    await expect(
      page.getByLabel("Reading progress", { exact: true }),
    ).toHaveText(expected[0].progress);
    await expect(page.getByLabel("Go To Page", { exact: true })).toHaveValue(
      expected[0].page,
    );
    await expect(editor.locator(".annotation-spelling")).toHaveCount(0);
    await expect(editor.locator(".annotation-repetition")).toHaveCount(1);
    await reader.locator("audio").evaluate((audio) => {
      audio.currentTime = 21;
    });
    await expect(
      page.getByLabel("Reading progress", { exact: true }),
    ).toHaveText(expected[1].progress);
    await expect(page.getByLabel("Go To Page", { exact: true })).toHaveValue(
      expected[1].page,
    );
    await reader
      .getByRole("button", { name: "Pause Reading", exact: true })
      .click();
    await expect(
      page.getByLabel("Reading progress", { exact: true }),
    ).toHaveText(expected[1].progress);
    await expect(editor.locator(".annotation-spelling")).toHaveCount(1);
    await reader
      .getByRole("button", { name: "Play Reading", exact: true })
      .click();
    await expect(editor.locator(".annotation-spelling")).toHaveCount(0);
    await reader
      .getByRole("button", { name: "Stop reading", exact: true })
      .click();
    await expect(
      page.getByLabel("Reading progress", { exact: true }),
    ).toHaveCount(0);
    await expect(editor.locator(".annotation-spelling")).toHaveCount(1);
  }
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({ caretResults, readingPositions: expected, errors }),
  );
} finally {
  await app.close();
}
