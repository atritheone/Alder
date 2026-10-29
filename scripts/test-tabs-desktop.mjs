import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/tabs");
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
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    fs.readFileSync(path.join(directory, "probe.js"), "utf8"),
  );
  const content = ["left", "center", "right", "decimal"].map((align, i) => ({
    type: "paragraph",
    attrs: {
      leftIndent: 12,
      tabStops: [
        { position: 144, align, leader: ["none", "dot", "dash", "line"][i] },
      ],
    },
    content: [{ type: "text", text: "Label\t12.34" }],
  }));
  content.push({
    type: "paragraph",
    attrs: {
      tabStops: [
        { position: 72, align: "left", leader: "dot" },
        { position: 216, align: "right", leader: "none" },
      ],
    },
    content: [{ type: "text", text: "A\tB\tC" }],
  });
  const doc = { type: "doc", content };
  for (const [scale, zoom] of [
    [1, 1],
    [0.5, 0.5],
    [1.5, 3],
  ]) {
    await page.evaluate(
      ({ doc, scale, zoom }) => {
        window.__layoutProbe.scale(scale);
        window.__layoutProbe.zoom(zoom);
        window.__layoutProbe.document(doc);
        window.__layoutProbe.capturePages(true);
      },
      { doc, scale, zoom },
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          try {
            return window.__layoutProbe.capture().pages.length;
          } catch {
            return 0;
          }
        }),
      )
      .toBeGreaterThan(0);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    const measurements = await page.evaluate(() =>
      [...document.querySelectorAll(".flow-canvas .ProseMirror p")].map((p) => {
        const rect = p.getBoundingClientRect(),
          scale = rect.width / p.offsetWidth;
        rect.x -= (parseFloat(getComputedStyle(p).marginLeft) || 0) * scale;
        const tabs = [...p.querySelectorAll(".alder-tab")];
        const values = tabs.map((t) => {
          const after = t.nextSibling;
          const range = document.createRange();
          range.selectNodeContents(after);
          const r = range.getBoundingClientRect();
          const str = after.textContent;
          const d = document.createRange();
          d.setStart(after, 0);
          d.setEnd(
            after,
            str.indexOf(".") >= 0 ? str.indexOf(".") : str.length,
          );
          return {
            left: ((r.left - rect.left) / scale) * 0.75,
            right: ((r.right - rect.left) / scale) * 0.75,
            center: (((r.left + r.right) / 2 - rect.left) / scale) * 0.75,
            decimal:
              ((d.getBoundingClientRect().right - rect.left) / scale) * 0.75,
            width: t.getBoundingClientRect().width / scale,
            leader: getComputedStyle(t).backgroundImage,
          };
        });
        return { values, text: p.textContent };
      }),
    );
    report.checks.push({ scale, zoom, measurements });
    for (let i = 0; i < 4; i++)
      expect(
        Math.abs(
          measurements[i].values[0][["left", "center", "right", "decimal"][i]] -
            144,
        ),
      ).toBeLessThan(1);
    expect(Math.abs(measurements[4].values[0].left - 72)).toBeLessThan(1);
    expect(Math.abs(measurements[4].values[1].right - 216)).toBeLessThan(1);
    expect(measurements.map((p) => p.text).join("\n")).toBe(
      "Label\t12.34\n".repeat(4) + "A\tB\tC",
    );
  }
  await page.evaluate(() => {
    window.__layoutProbe.scale(1);
    window.__layoutProbe.zoom(1);
  });
  const editor = page.getByRole("textbox", {
    name: "Text editor",
    exact: true,
  });
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.type("56");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .toContain("12.3456");
  await page.keyboard.press("Control+z");
  await expect
    .poll(() => page.evaluate(() => window.__layoutProbe.text()))
    .not.toContain("12.3456");
  const copied = await page.evaluate(
    (doc) => window.__layoutProbe.clipboardRoundTrip(doc),
    doc,
  );
  expect(copied[2].attrs.tabStops).toEqual(content[2].attrs.tabStops);
  await page.evaluate(() => {
    localStorage.setItem("alder.ruler", "true");
    window.dispatchEvent(new Event("alder-ruler"));
  });
  const ruler = page.getByLabel("Paragraph ruler in points");
  await expect(ruler).toBeVisible();
  const marker = ruler.getByRole("button", { name: "left tab at 144 points" });
  await marker.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    ruler.getByRole("button", { name: "left tab at 145 points" }),
  ).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(ruler.locator(".ruler-tab")).toHaveCount(0);
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect(
    ruler.getByRole("button", { name: "left tab at 145 points" }),
  ).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(marker).toBeVisible();
  const box = await marker.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__layoutProbe.doc().content[0].attrs.tabStops[0].position,
      ),
    )
    .toBeGreaterThan(170);
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect(marker).toBeVisible();
  await page.screenshot({ path: path.join(directory, "tabs.png") });
  const leftIndent = ruler.getByRole("button", {
    name: "Left indent: 12 points",
    exact: true,
  });
  await leftIndent.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(
    ruler.getByRole("button", { name: "Left indent: 22 points", exact: true }),
  ).toBeVisible();
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect(leftIndent).toBeVisible();
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Paragraph…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Paragraph", exact: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Tab 1 alignment", { exact: true })
    .selectOption("right");
  await dialog.getByLabel("Tab 1 leader", { exact: true }).selectOption("dot");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__layoutProbe.doc().content[0].attrs.tabStops),
    )
    .toEqual([{ position: 144, align: "right", leader: "dot" }]);
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+z");
  await expect(marker).toBeVisible();
  await page.evaluate(() => window.__layoutProbe.document({type:'doc',content:[{type:'paragraph',attrs:{leftIndent:12,align:'center',tabStops:[{position:216,align:'left',leader:'dot'}]},content:[{type:'text',text:'Label\t12.34'}]}]}));
  await expect.poll(()=>page.evaluate(()=>{
    const p=document.querySelector('.flow-canvas .ProseMirror p'), tab=p.querySelector('.alder-tab');
    const before=document.createRange(), after=document.createRange();
    before.selectNodeContents(p.firstChild);after.selectNodeContents(tab.nextSibling);
    const scale=p.getBoundingClientRect().width/p.offsetWidth;
    return (after.getBoundingClientRect().left-before.getBoundingClientRect().left)/scale*.75;
  })).toBeCloseTo(204,0);
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
