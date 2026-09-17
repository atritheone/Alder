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
        ...Array.from({ length: 20 }, (_, i) =>
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
  await expect(page.locator(".document-reader")).toBeHidden();
  await expect(cards.locator("button,header,footer")).toHaveCount(0);
  const first = await cards.first().boundingBox();
  const reveal = await page.locator(".reader-reveal").boundingBox();
  await page.mouse.move(reveal.x + reveal.width / 2, reveal.y + 4);
  await expect(page.locator(".document-reader")).toBeVisible();
  expect(await cards.first().boundingBox()).toEqual(first);
  const controls = await page.locator(".document-reader").boundingBox();
  await page.mouse.move(controls.x + 30, controls.y + controls.height - 3);
  await expect(page.locator(".document-reader")).toBeVisible();
  await page.getByLabel("Reading volume", { exact: true }).click();
  await page.mouse.move(first.x + first.width / 2, first.y + 100);
  await expect(page.locator(".document-reader")).toBeHidden();
  expect(
    await page
      .locator(".page-arranger")
      .evaluate((el) => el.scrollHeight - el.clientHeight),
  ).toBeGreaterThan(0);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(150);
  expect(
    await page.locator(".page-arranger").evaluate((el) => el.scrollTop),
  ).toBe(0);
  await expect(page.getByLabel("Page zoom", { exact: true })).toHaveValue(
    "0.8",
  );
  const area = await page.locator(".page-arranger").boundingBox();
  await page.mouse.move(area.x + 8, area.y + 80);
  await page.mouse.wheel(0, -120);
  await expect(page.getByLabel("Page zoom", { exact: true })).toHaveValue(
    "0.9",
  );
  expect((await cards.first().boundingBox()).width).toBeGreaterThan(
    first.width,
  );
  await page.mouse.wheel(0, 120);
  await expect(page.getByLabel("Page zoom", { exact: true })).toHaveValue(
    "0.8",
  );
  const indicator = await page
    .locator(".reader-reveal")
    .evaluate((el) => ({
      line: getComputedStyle(el, "::before").backgroundColor,
      bar: getComputedStyle(el.firstElementChild).backgroundColor,
      height: getComputedStyle(el, "::before").height,
    }));
  expect(indicator.line).toBe(indicator.bar);
  expect(indicator.height).toBe("3px");
  const total = await cards.count();
  await page.getByLabel("Go To Page", { exact: true }).fill(String(total));
  await page.getByLabel("Go To Page", { exact: true }).press("Enter");

  await expect
    .poll(() => page.locator(".page-arranger").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  const geometry = await page.evaluate(() => {
    const root = document.querySelector(".book-editor .ProseMirror");
    const canvas = root.closest(".flow-canvas");
    const base = canvas.getBoundingClientRect();
    const width = parseFloat(canvas.style.width);
    const scale = base.width / width;
    const pitch =
      parseFloat(canvas.style.getPropertyValue("--page-height")) + 28;
    const source = [...root.children];
    const failures = [];
    let checked = 0;
    document.querySelectorAll(".page-card").forEach((card, page) => {
      const sheet = card.querySelector(".page-snapshot"),
        origin = sheet.getBoundingClientRect(),
        ratio = origin.width / width;
      for (const copy of sheet.querySelector(".ProseMirror").children) {
        const original = source.find(
          (n) =>
            n.tagName === copy.tagName && n.textContent === copy.textContent,
        );
        if (!original) {
          failures.push("Missing source " + copy.tagName);
          continue;
        }
        const a = original.getBoundingClientRect(),
          b = copy.getBoundingClientRect();
        for (const [label, expected, actual] of [
          [
            "left",
            (a.left - base.left) / scale,
            (b.left - origin.left) / ratio,
          ],
          [
            "top",
            (a.top - base.top) / scale - page * pitch,
            (b.top - origin.top) / ratio,
          ],
          ["width", a.width / scale, b.width / ratio],
          ["height", a.height / scale, b.height / ratio],
        ])
          if (Math.abs(expected - actual) > 1)
            failures.push(
              `${page} ${copy.tagName} ${label}: ${expected} != ${actual}`,
            );
        const originalChildren = [
          ...original.querySelectorAll("p,li,td,img,strong"),
        ];
        const copyChildren = [...copy.querySelectorAll("p,li,td,img,strong")];
        for (let i = 0; i < originalChildren.length; i++) {
          const x = originalChildren[i].getBoundingClientRect(),
            y = copyChildren[i].getBoundingClientRect();
          for (const [label, expected, actual] of [
            ["nested top", (x.top - a.top) / scale, (y.top - b.top) / ratio],
            [
              "nested left",
              (x.left - a.left) / scale,
              (y.left - b.left) / ratio,
            ],
            ["nested height", x.height / scale, y.height / ratio],
          ])
            if (Math.abs(expected - actual) > 1)
              failures.push(
                `${page} ${copyChildren[i].tagName} ${label}: ${expected} != ${actual}`,
              );
        }
        checked++;
      }
      const number = card
        .querySelector(".page-card-number")
        .getBoundingClientRect();
      if (
        number.top < origin.bottom ||
        Math.abs(number.right - origin.right) > 1
      )
        failures.push("Number is not outside the bottom right");
    });
    return { checked, failures };
  });
  expect(
    await page
      .locator(".page-card img")
      .first()
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
  expect(geometry.checked).toBeGreaterThan(10);
  expect(geometry.failures).toEqual([]);
  expect((await saved()).book).toEqual(before.book);
  await page.getByLabel("Go To Page", { exact: true }).fill("1");
  await page.getByLabel("Go To Page", { exact: true }).press("Enter");
  const firstText = await cards.first().textContent();
  const from = await cards.first().boundingBox(),
    to = await cards.nth(1).boundingBox();
  const labels = await cards.locator(".page-card-number").allTextContents();
  await page.mouse.move(from.x + from.width / 2, from.y + 100);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 100, { steps: 12 });
  await expect(page.locator(".page-card.is-held")).toHaveCount(1);
  await expect(page.locator(".page-drop-gap")).toHaveCount(1);
  await expect
    .poll(async () => Math.abs((await cards.nth(1).boundingBox()).x - from.x))
    .toBeLessThan(2);
  expect(Math.abs((await cards.first().boundingBox()).x - to.x)).toBeLessThan(
    2,
  );
  expect(await cards.locator(".page-card-number").allTextContents()).toEqual(
    labels,
  );
  expect((await saved()).book).toEqual(before.book);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".page-drop-gap")).toHaveCount(0);
  expect((await saved()).book).toEqual(before.book);
  await page.mouse.move(from.x + from.width / 2, from.y + 100);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 100, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => cards.first().textContent()).not.toBe(firstText);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const moved = await saved();
  const text = (n) =>
    n.type === "text" ? n.text : (n.content || []).map(text).join(" ");
  expect(
    text(moved.book.chapters[0].document).split(/\s+/).filter(Boolean).sort(),
  ).toEqual(
    text(before.book.chapters[0].document).split(/\s+/).filter(Boolean).sort(),
  );
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await expect(page.locator(".document-reader")).toBeVisible();
  await editor.focus();
  await editor.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  expect((await saved()).book.chapters[0].document).toEqual(
    before.book.chapters[0].document,
  );
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect.poll(() => cards.count()).toBe(total);
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).first().click();
  await expect.poll(() => cards.count()).toBe(total);
  await expect(page.locator(".document-reader")).toBeHidden();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].showInactive(),
  );
  await page.screenshot({ path: path.join(data, "arrangement.png") });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      pages: total,
      geometry,
      hover: true,
      wheelOverPageBlocked: true,
      backgroundWheelZoom: true,
      dragDisplacementAndCancel: true,
      pageNavigation: true,
      dragAndUndo: true,
      screenshot: path.join(data, "arrangement.png"),
    }),
  );
} finally {
  const closed = app.waitForEvent("close", { timeout: 30000 });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await closed;
}
