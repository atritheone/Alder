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
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
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
              text: "Alpha sentence. Beta sentence has enough words to continue a little further. Gamma ends here.",
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
        ...Array.from({ length: 60 }, (_, i) =>
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
  const originalDocument = before.book.chapters[0].document;
  async function sentenceBox(text, last = false) {
    return page.locator(".page-card .unit-sentence").evaluateAll(
      (nodes, { text, last }) => {
        const unit = nodes.find(
          (el) => JSON.parse(el.dataset.unit).text === text,
        );
        const outline = last ? unit.lastElementChild : unit.firstElementChild;
        return outline.getBoundingClientRect().toJSON();
      },
      { text, last },
    );
  }
  const alpha = "Alpha sentence.",
    beta = "Beta sentence has enough words to continue a little further.",
    gamma = "Gamma ends here.";
  for (const [source, target, after, expected] of [
    [alpha, beta, true, `${beta} ${alpha} ${gamma}`],
    [gamma, alpha, false, `${gamma} ${alpha} ${beta}`],
  ]) {
    const a = await sentenceBox(source),
      b = await sentenceBox(target, after);
    await page.mouse.move(a.x + 0.5, a.y + 0.5);
    await page.mouse.down();
    await page.mouse.move(
      after ? b.x + b.width - 0.5 : b.x + 0.5,
      b.y + b.height / 2,
    );
    await expect(page.locator(".sentence-inline-gap")).toHaveCount(1);
    await expect(page.locator(".unit-held")).toHaveCSS(
      "outline-color",
      "rgb(186, 139, 44)",
    );
    await expect(page.locator(".sentence-inline-gap")).toHaveCSS(
      "outline-color",
      "rgb(186, 139, 44)",
    );
    await expect(page.locator(".unit-source-mask").first()).toHaveCSS(
      "border-top-color",
      "rgb(186, 139, 44)",
    );
    const preview = await page
      .locator(".sentence-inline-gap")
      .evaluate((el) => ({
        text: el
          .closest("[data-textblock-from]")
          .textContent.replace(/\s+/g, " ")
          .trim(),
        inline: getComputedStyle(el).display,
        width: Math.max(...Array.from(el.getClientRects(), (r) => r.width)),
        paragraphWidth: el
          .closest("[data-textblock-from]")
          .getBoundingClientRect().width,
      }));
    expect(preview.text).toBe(expected);
    expect(preview.inline).toBe("inline");
    expect(preview.width).toBeLessThan(preview.paragraphWidth);
    await page.screenshot({ path: path.join(data, "sentence-held.png") });
    await page.mouse.up();
    await expect(page.locator(".save-status")).toHaveText("Saved");
    const moved = await saved();
    const paragraph = moved.book.chapters[0].document.content.find(
      (n) => n.attrs?.align === "right",
    );
    expect(paragraph.content.map((n) => n.text || "").join("")).toBe(expected);
    await expect(
      page.locator(".unit-held,.unit-source-mask,.unit-drop-preview"),
    ).toHaveCount(0);
    // Allow the committed layout to finish, then require the editor to stay idle.
    const idle = await page.evaluate(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const times = [];
      let previous = performance.now(),
        stop = false;
      const frame = (now) => {
        times.push(now - previous);
        previous = now;
        if (!stop) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      stop = true;
      return { frames: times.length, maxFrame: Math.max(...times) };
    });
    expect(idle.frames).toBeGreaterThan(45);
    expect(idle.maxFrame).toBeLessThan(100);
    await page.getByRole("tab", { name: "Write", exact: true }).click();
    await editor.focus();
    await editor.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(page.locator(".save-status")).toHaveText("Saved");
    expect((await saved()).book.chapters[0].document).toEqual(originalDocument);
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    await expect.poll(() => cards.count()).toBeGreaterThan(3);
  }
  console.log(
    JSON.stringify({
      ok: true,
      inlineSentenceDisplacement: true,
      amberFeedback: true,
      postDropIdle: true,
      undo: true,
      screenshot: path.join(data, "sentence-held.png"),
    }),
  );
} finally {
  await app.close();
}
