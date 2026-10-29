import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/image-resize");
fs.mkdirSync(directory, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-tabs-"));
await build({
  entryPoints: ["scripts/layout-prototype.tsx"],
  bundle: true,
  outfile: path.join(directory, "probe.js"),
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const report = { status: "running", checks: [] };
let app, page;
const stage = (value) => {
  report.stage = value;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
};
try {
  stage("launch");
  app = await electron.launch({
    timeout: 10000,
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  stage("first window");
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(1800, 1200);
    w.setSize(1800, 1200);
    w.show();
    w.focus();
  });
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Chapter text editor", exact: true }),
  ).toBeVisible();
  stage("load probe");
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );

  await page.evaluate(() => {
    document.querySelector('[style*="z-index: 999999"]').style.zIndex = "1";
  });
  const src = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 100;
    const x = c.getContext("2d");
    x.fillStyle = "#23405e";
    x.fillRect(0, 0, 200, 100);
    return c.toDataURL();
  });
  for (const scale of [Number(process.env.ALDER_TEST_SCALE || 1)])
    for (const zoom of [1, 3])
      for (const align of ["left", "center", "right"]) {
        stage(`${scale}/${zoom}/${align}`);
        await page.evaluate(
          ({ src, scale, zoom, align }) => {
            window.__layoutProbe.scale(scale);
            window.__layoutProbe.zoom(zoom);
            window.__layoutProbe.document({
              type: "doc",
              content: [
                {
                  type: "image",
                  attrs: { src, width: 120, alt: "Resize fixture", align },
                },
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "After image" }],
                },
              ],
            });
          },
          { src, scale, zoom, align },
        );
        stage("image locate");
        const image = page.getByRole("img", {
          name: "Resize fixture",
          exact: true,
        });
        await expect(image).toBeVisible();
        stage("image click");
        await image.click();
        stage("handle locate");
        const handle = page.getByRole("button", {
          name: "Resize image",
          exact: true,
        });
        await expect(handle).toBeVisible();
        await expect
          .poll(async () => {
            const i = await image.boundingBox(),
              o = await page
                .locator(".image-resize-overlay:not([hidden])")
                .boundingBox();
            return (
              Math.abs(i.x - o.x) +
              Math.abs(i.y - o.y) +
              Math.abs(i.width - o.width)
            );
          })
          .toBeLessThan(2);
        const before = await image.boundingBox(),
          box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        report.viewport = await page.evaluate(() => ({
          w: innerWidth,
          h: innerHeight,
          screen: { w: screen.width, h: screen.height },
          scrollY,
        }));
        report.hit = await page.evaluate(
          ({ box }) =>
            document
              .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              ?.outerHTML.slice(0, 500),
          { box },
        );
        report.geometry = { scale, zoom, align, before, box };
        stage("pointer down");
        await page.mouse.down();
        report.heldAfterDown = await page
          .locator(".image-resize-overlay.is-resizing")
          .count();
        const delta =
          (align === "center" ? 15 : align === "right" ? -30 : 30) *
          scale *
          zoom;
        await page.mouse.move(
          box.x + box.width / 2 + delta,
          box.y + box.height / 2,
          { steps: 1 },
        );
        expect(
          await page.evaluate(
            () => window.__layoutProbe.doc().content[0].attrs.width,
          ),
        ).toBe(120);
        report.heldAfterMove = await page
          .locator(".image-resize-overlay.is-resizing")
          .count();
        stage("pointer up");
        await page.mouse.up();
        await expect
          .poll(() =>
            page.evaluate(
              () => window.__layoutProbe.doc().content[0].attrs.width,
            ),
          )
          .toBeCloseTo(150, 0);
        await expect
          .poll(async () => {
            const r = await image.boundingBox();
            return r.width / r.height;
          })
          .toBeCloseTo(2, 1);
        await page.keyboard.press("Control+z");
        await expect
          .poll(() =>
            page.evaluate(
              () => window.__layoutProbe.doc().content[0].attrs.width,
            ),
          )
          .toBe(120);
        stage("image click");
        await image.click();
        await handle.focus();
        await page.keyboard.press("Shift+ArrowRight");
        await expect
          .poll(() =>
            page.evaluate(
              () => window.__layoutProbe.doc().content[0].attrs.width,
            ),
          )
          .toBe(130);
        const next = await handle.boundingBox();
        await page.mouse.move(
          next.x + next.width / 2,
          next.y + next.height / 2,
        );
        report.viewport = await page.evaluate(() => ({
          w: innerWidth,
          h: innerHeight,
          screen: { w: screen.width, h: screen.height },
          scrollY,
        }));
        report.hit = await page.evaluate(
          ({ box }) =>
            document
              .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              ?.outerHTML.slice(0, 500),
          { box },
        );
        report.geometry = { scale, zoom, align, before, box };
        stage("pointer down");
        await page.mouse.down();
        report.heldAfterDown = await page
          .locator(".image-resize-overlay.is-resizing")
          .count();
        await page.mouse.move(next.x + 45, next.y + 10);
        await page.keyboard.press("Escape");
        report.heldAfterMove = await page
          .locator(".image-resize-overlay.is-resizing")
          .count();
        stage("pointer up");
        await page.mouse.up();
        expect(
          await page.evaluate(
            () => window.__layoutProbe.doc().content[0].attrs.width,
          ),
        ).toBe(130);
        report.checks.push({
          scale,
          zoom,
          align,
          drag: "one commit, aspect locked, undo, keyboard, cancel",
        });
      }

  const originalImage = page.getByRole("img", {
    name: "Resize fixture",
    exact: true,
  });
  await originalImage.dblclick();
  const properties = page.getByRole("dialog", {
    name: "Image properties",
    exact: true,
  });
  await properties.getByLabel("Decorative image", { exact: true }).check();
  await expect(
    properties.getByLabel("Image alternative text", { exact: true }),
  ).toBeDisabled();
  await properties.getByRole("button", { name: "Apply", exact: true }).click();
  const decorative = page
    .locator("[contenteditable=true] img[data-image-decorative=true]")
    .last();
  await expect(decorative).toHaveAttribute("role", "presentation");
  await expect(decorative).toHaveAttribute("alt", "");
  await decorative.dblclick();
  await properties.getByLabel("Decorative image", { exact: true }).uncheck();
  await expect(
    properties.getByLabel("Image alternative text", { exact: true }),
  ).toHaveValue("Resize fixture");
  await properties.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(originalImage).toBeVisible();
  report.checks.push(
    "decorative status suppresses the accessible description while retaining it for restoration",
  );
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await app?.close();
}
