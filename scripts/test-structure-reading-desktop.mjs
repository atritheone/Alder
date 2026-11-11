import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "alder-structure-reading-"));
const bundle = path.resolve("work/structure-reading-probe.js");
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: bundle,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
});
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${data}/profile`],
  env: { ...process.env, ALDER_DATA_DIR: `${data}/data` },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.evaluate(fs.readFileSync(bundle, "utf8"));
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe?.ready()))
    .toBe(true);
  await page.evaluate(() => {
    window.__layoutProbe.document({
      type: "doc",
      content: Array.from({ length: 120 }, (_, index) => ({
        type: "paragraph",
        content: [
          {
            type: "text",
            text:
              `Paragraph ${index}. 🌲 ` +
              "Words retain their exact wrapping and page boundaries. ".repeat(
                24,
              ),
          },
        ],
      })),
    });
    window.__layoutProbe.structure(true);
  });
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.ready()), {
      timeout: 60000,
    })
    .toBe(true);
  const before = await page.evaluate(() => ({
    text: window.__layoutProbe.text(),
    pages: window.__layoutProbe.pages().length,
  }));
  expect(before.pages).toBeGreaterThan(40);
  const editor = page.getByRole("textbox", {
    name: "Text editor",
    exact: true,
  });
  for (const index of [0, 60, 119]) {
    await page.evaluate((index) => {
      const probe = window.__layoutProbe;
      const start = probe.text().indexOf(`Paragraph ${index}.`);
      probe.highlight(start, start + 9);
    }, index);
    await expect(editor.locator(".reading-word")).toHaveText("Paragraph");
    for (const visible of [false, true]) {
      await page.evaluate(
        (visible) => window.__layoutProbe.structure(visible),
        visible,
      );
      await expect(editor.locator(".reading-word")).toHaveText("Paragraph");
      const current = await page.evaluate(() => ({
        text: window.__layoutProbe.text(),
        pages: window.__layoutProbe.pages().length,
      }));
      expect(current).toEqual(before);
    }
  }
  expect(await editor.locator(".structure-whitespace").count()).toBeGreaterThan(
    20000,
  );
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      status: "passed",
      paragraphs: 120,
      pages: before.pages,
      readingHighlights: true,
      stableTextAndPages: true,
      errors,
    }),
  );
} finally {
  const timer = setTimeout(() => app.process().kill(), 10000);
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
}
