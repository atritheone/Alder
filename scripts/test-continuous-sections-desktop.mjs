import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-continuous-")),
  directory = path.resolve("work/continuous-sections");
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", checks: [], errors: [] };
let app, page;
const stage = (value) => {
  report.stage = value;
  fs.writeFileSync(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2),
  );
};
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(6000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  for (const kind of [
    "ordinary",
    "restart",
    "first",
    "paper",
    "horizontal",
    "vertical",
  ]) {
    stage(kind);
    const fixture = JSON.parse(
      fs.readFileSync(
        path.resolve(`work/continuous-word-${kind}/fixture-project.json`),
        "utf8",
      ),
    );
    const id = await page.evaluate(
      async ({ fixture, kind }) => {
        const p = await window.alder.request("POST", "/api/projects", {
          template: "blank",
          name: `Continuous ${kind}`,
        });
        p.settings = fixture.settings;
        p.book = fixture.book;
        await window.alder.request("PUT", `/api/projects/${p.id}`, {
          project: p,
          expectedRevision: p.revision,
        });
        return p.id;
      },
      { fixture, kind },
    );
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: `Continuous ${kind}` })
      .click();
    await page.getByRole("tab", { name: "Write", exact: true }).click();
    const editor = page.getByRole("textbox", {
        name: "Chapter text editor",
        exact: true,
      }),
      sheets = page.locator(".page-sheets > .page-sheet");
    await expect(sheets).toHaveCount(kind === "paper" ? 3 : 2);
    await expect(
      sheets.first().locator("[data-running-story=header]"),
    ).toHaveText("PRE HEADER");
    await expect(
      sheets.last().locator("[data-running-story=header]"),
    ).toHaveText("POST HEADER");
    await expect(
      sheets.last().locator("[data-running-story=footer]"),
    ).toHaveText(
      kind === "restart" ? "Page 10" : kind === "paper" ? "Page 3" : "Page 2",
    );
    const geometry = await page.evaluate(() => {
      const root = document.querySelector(".flow-canvas"),
        scale = root.getBoundingClientRect().width / root.offsetWidth;
      const boxes = [
        ...document.querySelectorAll(".page-sheets > .page-sheet"),
      ].map((x) => x.getBoundingClientRect());
      return [
        ...document.querySelectorAll('[aria-label="Chapter text editor"] > p'),
      ].map((p) => {
        const r = p.getBoundingClientRect(),
          index = boxes.findIndex(
            (b) => r.top >= b.top - 1 && r.top < b.bottom,
          );
        return {
          text: p.textContent,
          page: index,
          x: (r.left - boxes[index].left) / scale,
          y: (r.top - boxes[index].top) / scale,
        };
      });
    });
    const before = geometry.find((p) => p.text === "BEFORE SECTION"),
      after = geometry.find((p) => p.text === "AFTER SECTION"),
      later = geometry.find((p) => p.text === "LATER BODY");
    expect(after.page).toBe(kind === "paper" ? 1 : 0);
    if (kind === "horizontal")
      expect(after.x - before.x).toBeCloseTo((18 * 96) / 25.4, 0);
    if (kind === "vertical")
      expect(later.y - before.y).toBeCloseTo((18 * 96) / 25.4, 0);
    // Editing after the continuous boundary must keep pending section settings.
    await editor.press("Control+End");
    await page.keyboard.type(" edited");
    await expect(sheets).toHaveCount(kind === "paper" ? 3 : 2);
    await editor.press("Control+z");
    await expect(editor).not.toContainText("edited");
    await expect(page.locator(".save-status")).toHaveText("Saved");
    const pdf = await page.evaluate(async (id) => {
      const result = await window.alder.request(
        "POST",
        `/api/projects/${id}/export`,
        { format: "pdf" },
      );
      return {
        result,
        bytes: [
          ...new Uint8Array(
            await (
              await fetch(window.alder.mediaBase + result.downloadUrl)
            ).arrayBuffer(),
          ),
        ],
      };
    }, id);
    expect(pdf.result.validation.pages).toBe(kind === "paper" ? 3 : 2);
    fs.writeFileSync(
      path.join(directory, `${kind}.pdf`),
      Buffer.from(pdf.bytes),
    );
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    await expect(page.locator(".page-card")).toHaveCount(
      kind === "paper" ? 3 : 2,
    );
    await expect(
      page.locator(".page-card").last().locator("[data-running-story=header]"),
    ).toHaveText("POST HEADER");
    report.checks.push({ kind, geometry, pages: pdf.result.validation.pages });
  }
  expect(report.errors).toEqual([]);
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
