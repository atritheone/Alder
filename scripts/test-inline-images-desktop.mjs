import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/inline-images");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-inline-"));
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const report = { status: "running", checks: [] };
const stage = (s) => {
  report.stage = s;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
};
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(1600, 1100);
    w.setSize(1600, 1100);
    w.show();
    w.focus();
  });
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Chapter text editor", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  await page.evaluate(() => {
    document.querySelector('[style*="z-index: 999999"]').style.zIndex = "1";
  });
  stage("inline placement, resize, focus and undo");
  const src = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 60;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#23405e";
    ctx.fillRect(0, 0, 120, 60);
    return c.toDataURL();
  });
  const picture = {
    type: "inline_image",
    attrs: { src, width: 80, alt: "Inline fixture", blockId: "picture" },
  };
  const paragraph = {
    type: "paragraph",
    content: [
      { type: "text", text: "Before ", marks: [{ type: "strong" }] },
      picture,
      { type: "text", text: " after." },
    ],
  };
  await page.evaluate((doc) => window.__layoutProbe.document(doc), {
    type: "doc",
    content: [paragraph],
  });
  const image = page.getByRole("img", { name: "Inline fixture", exact: true });
  await expect(image).toBeVisible();
  await image.dblclick();
  const dialog = page.getByRole("dialog", {
    name: "Image properties",
    exact: true,
  });
  await expect(dialog.getByLabel("Image placement")).toHaveValue("inline");
  await dialog.getByLabel("Image placement").selectOption("block");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__layoutProbe.doc().content.map((n) => n.type),
      ),
    )
    .toEqual(["paragraph", "image", "paragraph"]);
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.doc().content.length))
    .toBe(1);
  await image.click();
  const handle = page.getByRole("button", {
    name: "Resize image",
    exact: true,
  });
  await expect(handle).toBeVisible();
  const h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 20, h.y + h.height / 2);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__layoutProbe.doc().content[0].content[1].attrs.width,
      ),
    )
    .toBeCloseTo(100, 0);
  await page.keyboard.press("Control+z");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__layoutProbe.doc().content[0].content[1].attrs.width,
      ),
    )
    .toBe(80);
  report.checks.push(
    "Inline properties, block conversion, immediate undo and proportional pointer resizing retain surrounding prose.",
  );
  stage("clipboard");
  const copied = await page.evaluate(() =>
    window.__layoutProbe.clipboardRoundTrip(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Before ", marks: [{ type: "strong" }] },
              {
                type: "inline_image",
                attrs: {
                  src: "/api/projects/example/assets/art",
                  assetId: "art",
                  width: 48,
                  alt: "Art",
                  title: "Title",
                  decorative: true,
                },
              },
              { type: "text", text: " after" },
            ],
          },
        ],
      },
      { "/api/projects/example/assets/art": "art" },
    ),
  );
  expect(copied.length).toBe(1);
  expect(copied[0].content[1].type).toBe("inline_image");
  expect(copied[0].content[1].attrs).toMatchObject({
    alt: "Art",
    title: "Title",
    decorative: true,
    assetId: "art",
  });
  expect(copied[0].content[0].marks[0].type).toBe("strong");
  report.checks.push(
    "Collected inline picture, surrounding marks and decorative descriptions survive HTML clipboard round trip.",
  );
  const long = {
    type: "doc",
    content: Array.from({ length: 28 }, (_, i) => ({
      type: "paragraph",
      attrs: { spaceAfter: 0, lineHeight: 1.5 },
      content: [
        { type: "text", text: `LINE${String(i).padStart(3, "0")} before ` },
        ...(i % 3 === 1
          ? [
              {
                ...picture,
                attrs: { ...picture.attrs, blockId: `image${i}`, width: 100 },
              },
            ]
          : []),
        { type: "text", text: " after." },
      ],
    })),
  };
  await page.evaluate((doc) => {
    window.__layoutProbe.pageSize({ width: 500, height: 380, margin: 40 });
    window.__layoutProbe.document(doc);
  }, long);
  let baseline;
  for (const scale of [0.5, 1, 1.5])
    for (const zoom of [1, 3]) {
      stage(`page ownership ${scale}/${zoom}`);
      await page.evaluate(
        ({ scale, zoom }) => {
          window.__layoutProbe.scale(scale);
          window.__layoutProbe.zoom(zoom);
        },
        { scale, zoom },
      );
      await expect
        .poll(() =>
          page.evaluate(() => {
            try {
              return window.__layoutProbe.pages().length;
            } catch {
              return 0;
            }
          }),
        )
        .toBeGreaterThan(2);
      await page.waitForTimeout(150);
      const measured = await page.evaluate(() => {
        const root = document.querySelector('[aria-label="Text editor"]'),
          r = root.getBoundingClientRect();
        const scale = r.width / root.offsetWidth;
        return {
          paragraphs: [...root.querySelectorAll("p")].map((p) => {
            const b = p.getBoundingClientRect();
            return {
              text: p.textContent,
              top: (b.top - r.top) / scale,
              bottom: (b.bottom - r.top) / scale,
              spacer: p.querySelector(".pagination-spacer")?.outerHTML,
            };
          }),
          pages: window.__layoutProbe.pages(),
          images: [...root.querySelectorAll("img")].map((img) => {
            const b = img.getBoundingClientRect();
            return {
              top: (b.top - r.top) / scale,
              bottom: (b.bottom - r.top) / scale,
            };
          }),
        };
      });
      report.measured = measured;
      for (const image of measured.images) {
        const index = Math.floor((image.top + 40) / 408);
        expect(image.top - index * 408).toBeGreaterThanOrEqual(-0.5);
        expect(image.bottom - index * 408).toBeLessThanOrEqual(300.5);
      }
      const ranges = measured.pages.map((p) => [p.from, p.to]);
      if (baseline) expect(ranges).toEqual(baseline);
      else baseline = ranges;
    }
  stage("full reflow");
  await page.evaluate(() => {
    window.__layoutProbe.scale(1);
    window.__layoutProbe.zoom(1);
    window.__layoutProbe.fullLayout();
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        try {
          return window.__layoutProbe.pages().map((p) => [p.from, p.to]);
        } catch {
          return [];
        }
      }),
    )
    .toEqual(baseline);
  await page.screenshot({ path: path.join(directory, "editor.png") });
  const publication = await page.evaluate(() => window.__layoutProbe.capture());
  fs.writeFileSync(path.join(directory, "publication.html"), publication.html);
  const pdf = await app.evaluate(async ({ BrowserWindow }, html) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true },
    });
    try {
      await win.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      await win.webContents.executeJavaScript("document.fonts.ready");
      return (
        await win.webContents.printToPDF({
          preferCSSPageSize: true,
          printBackground: true,
        })
      ).toString("base64");
    } finally {
      win.destroy();
    }
  }, publication.html);
  fs.writeFileSync(
    path.join(directory, "pages.pdf"),
    Buffer.from(pdf, "base64"),
  );
  report.checks.push(
    "Inline picture lines stay inside page bodies at three UI scales and 100/300% zoom; full layout agrees.",
  );
  stage("multi-page paragraph");
  const grouped = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { spaceAfter: 0, lineHeight: 1.5 },
        content: long.content.flatMap((p, i) => [
          ...(i ? [{ type: "hard_break" }] : []),
          ...p.content,
        ]),
      },
    ],
  };
  await page.evaluate((doc) => window.__layoutProbe.document(doc), grouped);
  await expect
    .poll(() =>
      page.evaluate(() => {
        try {
          return window.__layoutProbe.pages().length;
        } catch {
          return 0;
        }
      }),
    )
    .toBeGreaterThan(2);
  const groupedPages = await page.evaluate(() => window.__layoutProbe.pages());
  const errors = await page.evaluate(() => {
    const root = document.querySelector('[aria-label="Text editor"]'),
      origin = root.getBoundingClientRect(),
      scale = origin.width / root.offsetWidth;
    return [...root.querySelectorAll("img")].flatMap((image) => {
      const rect = image.getBoundingClientRect(),
        top = (rect.top - origin.top) / scale,
        bottom = (rect.bottom - origin.top) / scale,
        index = Math.floor((top + 40) / 408);
      return top - index * 408 < -0.5 || bottom - index * 408 > 300.5
        ? [{ top, bottom, index }]
        : [];
    });
  });
  expect(errors).toEqual([]);
  await page.evaluate(() => window.__layoutProbe.fullLayout());
  await expect
    .poll(() =>
      page.evaluate(() => {
        try {
          return window.__layoutProbe.pages().map((p) => [p.from, p.to]);
        } catch {
          return [];
        }
      }),
    )
    .toEqual(groupedPages.map((p) => [p.from, p.to]));
  report.checks.push(
    "Pictures inside a single multi-page paragraph retain their full line height and full/incremental page boundaries agree.",
  );
  report.status = "passed";
  stage("complete");
} catch (error) {
  report.status = "failed";
  report.error = String(error?.stack || error);
  stage(report.stage);
  process.exitCode = 1;
  if (page)
    await page
      .screenshot({ path: path.join(directory, "failure.png") })
      .catch(() => {});
} finally {
  await app?.close();
}
