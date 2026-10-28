// Diagnostic only: baseline-preserving fixed leading must pass this before
// becoming an editor feature. It does not alter saved documents or app CSS.
import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-leading-"));
let app;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  const page = await app.firstWindow();
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  const results = await page.evaluate(async () => {
    await document.fonts.ready;
    const results = [];
    const canvas = document.createElement("canvas"),
      context = canvas.getContext("2d");
    for (const family of ["Cambria", "Arial", "Times New Roman"])
      for (const size of [48, 96, 144]) {
        const host = document.createElement("div");
        host.style.cssText = `position:fixed;left:0;top:0;width:1400px;font:16px/24px "${family}";white-space:pre-wrap;`;
        const mid = (font) => {
          context.font = font;
          const metrics = context.measureText("Mg");
          return (
            (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2
          );
        };
        const delta = mid(`16px "${family}"`) - mid(`${size}px "${family}"`);
        for (let i = 0; i < 3; i++) {
          const large = document.createElement("span");
          large.style.cssText = `font-size:${size}px;line-height:0;vertical-align:${delta}px;position:relative;top:${delta}px;`;
          large.textContent = "Large";
          const largeBaseline = document.createElement("i");
          largeBaseline.style.cssText =
            "display:inline-block;width:0;height:0;vertical-align:baseline";
          large.append(largeBaseline);
          const small = document.createElement("span");
          small.textContent = " small";
          const smallBaseline = largeBaseline.cloneNode();
          small.append(smallBaseline);
          host.append(large, small);
          if (i < 2) host.append(document.createElement("br"));
        }
        document.body.append(host);
        const spans = [...host.children].filter(
          (element) => element.tagName === "SPAN",
        );
        const baselines = spans.map(
          (span) => span.querySelector("i").getBoundingClientRect().top,
        );
        host.querySelectorAll("i").forEach((element) => element.remove());
        results.push({
          family,
          size,
          delta,
          height: host.getBoundingClientRect().height,
          pitch:
            spans[2].getBoundingClientRect().top -
            spans[0].getBoundingClientRect().top,
          baselines,
        });
        host.remove();
      }
    return results;
  });
  fs.writeFileSync(
    "work/exact-leading-probe.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  await app?.close();
}
