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
  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await editor.focus();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({
    name: "layout.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(editor.locator("img")).toHaveCount(1);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const name = await page.evaluate(async () => {
    const id = localStorage.getItem("alder.project");
    const p = await window.alder.request("GET", `/api/projects/${id}`);
    const para = (text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    });
    p.book.chapters[0].document = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Measured page layout" }],
        },
        {
          type: "paragraph",
          attrs: { align: "right", fontSize: 19, color: "#aa2233" },
          content: [
            {
              type: "text",
              text: "Right aligned bold text",
              marks: [{ type: "strong" }],
            },
          ],
        },
        ...[
          "Alice was beginning to get very tired of sitting by her sister",
          "on the bank, and of having nothing to do: once or twice she had",
          "peeped into the book her sister was reading, but it had no",
          "pictures or conversations in it, 'and what is the use of a book,'",
          "thought Alice 'without pictures or conversation?'",
        ].map(para),
        { type: "paragraph" },
        {
          type: "bullet_list",
          content: [
            { type: "list_item", content: [para("First list item")] },
            { type: "list_item", content: [para("Second list item")] },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "table_row",
              content: [
                { type: "table_cell", content: [para("Table left")] },
                { type: "table_cell", content: [para("Table right")] },
              ],
            },
          ],
        },
        {
          type: "image",
          attrs: {
            src: `/api/projects/${id}/assets/${p.assets[0].id}`,
            assetId: p.assets[0].id,
            width: 120,
            alt: "Layout test image",
          },
        },
        ...Array.from({ length: 120 }, (_, i) =>
          para(
            `Paragraph ${i}. ` +
              "Words retain their exact wrapping and page boundaries. ".repeat(
                24,
              ),
          ),
        ),
        { type: "page_break" },
        para("Explicit last page"),
      ],
    };
    await window.alder.request("PUT", `/api/projects/${id}`, {
      expectedRevision: p.revision,
      project: p,
    });
    return p.name;
  });
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).first().click();
  await expect(editor).toContainText("Measured page layout");
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.locator(".book-editor .page-sheet").count())
    .toBeGreaterThan(3);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const saved = () =>
    page.evaluate(async () =>
      window.alder.request(
        "GET",
        `/api/projects/${localStorage.getItem("alder.project")}`,
      ),
    );
  await editor.focus();
  await editor.press("End");
  await editor.press("Space");
  await editor.press("Backspace");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const before = await saved();
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  const cards = page.locator(".page-card");
  await expect.poll(() => cards.count()).toBeGreaterThan(3);
  // Hidden Electron windows throttle animation frames to one per second.
  // Measure a visible, inactive test window, not that background timer policy.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  const timings = await page.evaluate(async () => {
    const waitFrame = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    const results = [];
    for (const kind of ["paragraph", "sentence"]) {
      const originalPage = document.querySelector(".page-card .page-snapshot");
      const editorCount = document.querySelectorAll(
        ".ProseMirror[contenteditable]",
      ).length;
      const layer = Array.from(
        document.querySelectorAll(`.page-card .unit-${kind}`),
      ).find((el) => JSON.parse(el.dataset.unit).text.startsWith("Alice was"));
      const source = layer.firstElementChild.getBoundingClientRect();
      const target = document
        .querySelectorAll(".page-card")[1]
        .querySelector(`.unit-${kind} .unit-outline`)
        .getBoundingClientRect();
      const dispatch = (type, x, y) => {
        const el = document.elementFromPoint(x, y);
        const start = performance.now();
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: x,
            clientY: y,
          }),
        );
        return performance.now() - start;
      };
      // Synthetic events cannot acquire pointer capture. Ignore that native-only call.
      const original = Element.prototype.setPointerCapture;
      Element.prototype.setPointerCapture = () => {};
      const pickup = dispatch(
        "pointerdown",
        source.left + 0.5,
        source.top + 0.5,
      );
      await waitFrame();
      if (!document.querySelector(".unit-held"))
        throw new Error("Unit did not lift");
      const moves = [];
      for (let n = 0; n < 6; n++) {
        const start = performance.now();
        const handler = dispatch(
          "pointermove",
          target.left + 2,
          target.top + 8 + n * 12,
        );
        await waitFrame();
        moves.push({ handler, frame: performance.now() - start });
        const ghost = document
          .querySelector(".unit-held")
          .getBoundingClientRect();
        if (Math.abs(ghost.left - (target.left + 1.5)) > 2)
          throw new Error("Held unit did not follow the pointer");
        if (
          document.querySelector(".page-card .page-snapshot") !==
            originalPage ||
          document.querySelectorAll(".ProseMirror[contenteditable]").length !==
            editorCount
        )
          throw new Error("Drag rebuilt the editor or page snapshots");
      }
      const dropStart = performance.now();
      if (kind === "sentence")
        dispatch("pointerup", target.left + 2, target.top + 68);
      else
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      Element.prototype.setPointerCapture = original;
      await waitFrame();
      const drop = performance.now() - dropStart;
      if (
        document.querySelector(
          ".unit-held,.unit-source-mask,.unit-drop-preview",
        )
      )
        throw new Error("Drag feedback was not cleaned up");
      results.push({
        kind,
        pickup,
        moves,
        ...(kind === "sentence" ? { drop } : {}),
      });
    }
    return results;
  });
  console.log(JSON.stringify({ pages: await cards.count(), timings }));
  await expect(page.locator(".save-status")).toHaveText("Saved");
  expect((await saved()).book.chapters[0].document).not.toEqual(
    before.book.chapters[0].document,
  );
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await editor.focus();
  await editor.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  expect((await saved()).book.chapters[0].document).toEqual(
    before.book.chapters[0].document,
  );
  if (!process.env.ALDER_PERF_BASELINE) {
    for (const result of timings) {
      expect(result.pickup).toBeLessThan(100);
      expect(Math.max(...result.moves.map((m) => m.handler))).toBeLessThan(32);
      expect(Math.max(...result.moves.map((m) => m.frame))).toBeLessThan(150);
    }
  }
} finally {
  await app.close();
}
