import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [
    ".",
    "--headless-test",
    `--user-data-dir=${path.resolve(`work/vertical-ui-${Date.now()}`)}`,
  ],
  env: {
    ...process.env,
    ALDER_DATA_DIR: path.resolve(`work/vertical-data-${Date.now()}`),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const text =
    "This is a continuous paragraph that must wrap from the bottom of one page to the top of the next without changing any wording. ".repeat(
      900,
    );
  await editor.fill(text);
  await expect
    .poll(() => page.locator(".page-sheet").count())
    .toBeGreaterThan(2);
  console.log("pages", await page.locator(".page-sheet").count());
  const measureGeometry = () =>
    editor.evaluate((el) => {
      const canvas = el.closest(".flow-canvas"),
        sheets = [...canvas.querySelectorAll(".page-sheet")].map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
      const bounds = el.getBoundingClientRect(),
        scale = bounds.width / el.offsetWidth,
        margin =
          parseFloat(
            getComputedStyle(canvas).getPropertyValue("--page-margin"),
          ) * scale;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
        failures = [];
      let node;
      while ((node = walker.nextNode())) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width < 1) continue;
          if (
            !sheets.some(
              (s) =>
                r.top >= s.y + margin - 3 &&
                r.bottom <= s.y + s.height - margin + 3,
            )
          )
            failures.push({
              top: r.top,
              bottom: r.bottom,
              text: node.textContent.slice(0, 30),
            });
        }
      }
      return {
        sheets,
        failures: failures.slice(0, 12),
        spacers: [...el.querySelectorAll(".pagination-spacer")].map((e) => ({
          height: e.style.height,
          top: e.getBoundingClientRect().top,
        })),
        scroll: {
          width: el.closest(".editor-scroll").scrollWidth,
          client: el.closest(".editor-scroll").clientWidth,
        },
      };
    });
  const geometry = await measureGeometry();
  console.log(JSON.stringify(geometry));
  const capture = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      )
    )
      .toPNG()
      .toString("base64"),
  );
  fs.writeFileSync("work/vertical-pages.png", Buffer.from(capture, "base64"));
  expect(geometry.sheets[1].y).toBeGreaterThan(
    geometry.sheets[0].y + geometry.sheets[0].height,
  );
  expect(Math.abs(geometry.sheets[1].x - geometry.sheets[0].x)).toBeLessThan(1);
  expect(geometry.failures).toEqual([]);
  expect(geometry.scroll.width).toBeLessThanOrEqual(geometry.scroll.client + 2);
  await expect(editor).toHaveText(text.trim());
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.waitForTimeout(250);
  await editor.focus();
  for (const key of [
    "Control+End",
    "ArrowUp",
    "ArrowUp",
    "Control+Home",
    "ArrowDown",
    "Control+End",
  ]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
    expect(
      (await measureGeometry()).failures,
      `Page alignment after ${key}`,
    ).toEqual([]);
  }

  const field = page.getByRole("spinbutton", {
    name: "Go To Page",
    exact: true,
  });
  await field.fill("2");
  await field.press("Enter");
  await expect
    .poll(() =>
      page
        .locator(".paginated-editor .editor-scroll")
        .evaluate((e) => e.scrollTop),
    )
    .toBeGreaterThan(500);
  await expect(page.locator(".page-navigation button")).toHaveCount(0);
  await expect(page.locator(".paginated-editor .editor-scroll")).toHaveCSS(
    "scrollbar-width",
    "none",
  );
  await expect(page.locator(".pane").first()).toHaveCSS("border-radius", "0px");
  await expect(
    page.getByLabel("Reading speed slider", { exact: true }),
  ).toHaveCSS("width", "80px");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" Last words.");
  await expect(editor).toContainText("Last words.");
  await page.getByLabel("Page zoom", { exact: true }).selectOption("1.25");
  await expect
    .poll(() => page.locator(".page-sheet").count())
    .toBe(geometry.sheets.length);
  await page.getByLabel("Page zoom", { exact: true }).selectOption("0.8");
  await editor.fill("First page.");
  await expect.poll(() => page.locator(".page-sheet").count()).toBe(1);
  await page
    .getByRole("button", { name: "Insert page break", exact: true })
    .first()
    .click();
  await editor.press("Control+End");
  await page.keyboard.insertText("Second page.");
  await expect.poll(() => page.locator(".page-sheet").count()).toBe(2);
  await expect(editor).toContainText("Second page.");
  const html = `<html><body><p>A formatted import.</p><table>${Array.from(
    { length: 90 },
    (_, i) =>
      `<tr><td>Row ${i + 1}</td><td><strong>Formatted text</strong> on row ${i + 1}</td></tr>`,
  ).join("")}</table><p>End of import.</p></body></html>`;
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "Vertical table.html",
      mimeType: "text/html",
      buffer: Buffer.from(html),
    });
  await expect(editor).toContainText("End of import.");
  await expect
    .poll(() => page.locator(".page-sheet").count())
    .toBeGreaterThan(2);
  await expect(editor.locator("tr:not(.pagination-spacer)")).toHaveCount(90);
  const tableFailures = await editor.evaluate((el) => {
    const canvas = el.closest(".flow-canvas");
    const sheets = [...canvas.querySelectorAll(".page-sheet")].map((e) =>
      e.getBoundingClientRect(),
    );
    const scale = el.getBoundingClientRect().width / el.offsetWidth;
    const margin =
      parseFloat(getComputedStyle(canvas).getPropertyValue("--page-margin")) *
      scale;
    return [...el.querySelectorAll("tr:not(.pagination-spacer)")]
      .filter((row) => {
        const r = row.getBoundingClientRect();
        return !sheets.some(
          (s) =>
            r.top >= s.top + margin - 3 && r.bottom <= s.bottom - margin + 3,
        );
      })
      .map((row) => row.textContent);
  });
  expect(tableFailures).toEqual([]);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(900, 800),
  );
  await page.getByLabel("Page zoom", { exact: true }).selectOption("1.25");
  const scroll = page.locator(".paginated-editor .editor-scroll");
  await expect
    .poll(() => scroll.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeGreaterThan(30);
  await scroll.evaluate((el) => {
    el.scrollLeft = 80;
    el.scrollTop = 200;
  });
  expect(await scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(20);
  expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(20);
  expect(errors).toEqual([]);
  console.log("PASS vertical pages and Enter navigation");
} catch (e) {
  console.error(e);
  throw e;
} finally {
  await app.close();
}
