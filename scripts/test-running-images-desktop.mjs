import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const directory = path.resolve("work/running-images"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-running-images-"));
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
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.show();
    w.focus();
    w.setSize(1400, 1000);
  });
  const fixture = JSON.parse(
    fs.readFileSync("work/running-images-word/fixture-project.json", "utf8"),
  );
  const id = await page.evaluate(async (fixture) => {
    const p = await window.alder.request("POST", "/api/projects", {
      template: "blank",
      name: "Running images",
    });
    const asset = await window.alder.upload(
      `/api/projects/${p.id}/assets?register=false`,
      "Logo.png",
      [
        ...Uint8Array.from(atob(fixture.assets[0].data), (c) =>
          c.charCodeAt(0),
        ),
      ],
      {},
    );
    const walk = (node) => {
      if (node.attrs?.assetId) {
        node.attrs.assetId = asset.id;
        node.attrs.src = `/api/projects/${p.id}/assets/${asset.id}`;
      }
      node.content?.forEach(walk);
    };
    walk(fixture.settings.runningMatter.header.default);
    p.settings = fixture.settings;
    p.book = fixture.book;
    p.assets = [asset];
    await window.alder.request("PUT", `/api/projects/${p.id}`, {
      project: p,
      expectedRevision: p.revision,
    });
    return p.id;
  }, fixture);
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Running images" })
      .click();
  };
  await reopen();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    sheets = page.locator(".page-sheets > .page-sheet"),
    dialog = page.getByRole("dialog", {
      name: "Headers and footers",
      exact: true,
    }),
    story = page.getByRole("textbox", {
      name: "Header text editor",
      exact: true,
    });
  const menu = async () => {
    await editor.press("Control+Home");
    await page
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Headers and footers…", exact: true })
      .click();
  };
  stage("loaded image geometry");
  await expect(sheets).toHaveCount(2);
  await expect(
    sheets.first().locator("[data-running-story] img[src]"),
  ).toHaveAttribute("alt", "Company logo");
  await expect
    .poll(() =>
      sheets
        .first()
        .locator("[data-running-story] img[src]")
        .evaluate(
          (img) =>
            img.getBoundingClientRect().width /
            img.getBoundingClientRect().height,
        ),
    )
    .toBeCloseTo(1, 1);
  stage("image properties");
  await menu();
  await story.locator("img[src]").click();
  await dialog
    .getByLabel("Header/footer image", { exact: true })
    .selectOption("properties");
  let properties = page.getByRole("dialog", {
    name: "Image properties",
    exact: true,
  });
  await properties.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(properties).toHaveCount(0);
  await dialog
    .getByLabel("Header/footer image", { exact: true })
    .selectOption("properties");
  await properties
    .getByLabel("Image alternative text", { exact: true })
    .fill("Edited company logo");
  await properties.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(story.locator("img[src]")).toHaveAttribute(
    "alt",
    "Edited company logo",
  );
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sheets.first().locator("img[src]")).toHaveAttribute(
    "alt",
    "Edited company logo",
  );
  await editor.press("Control+z");
  await expect(sheets.first().locator("img[src]")).toHaveAttribute(
    "alt",
    "Company logo",
  );
  await editor.press("Control+y");
  await expect(sheets.first().locator("img[src]")).toHaveAttribute(
    "alt",
    "Edited company logo",
  );
  report.checks.push(
    "Decoded crop geometry, properties Apply/Cancel and project undo/redo.",
  );
  stage("upload and insert");
  await menu();
  await story.press("Control+End");
  const logo = Buffer.from(fixture.assets[0].data, "base64");
  await dialog
    .getByLabel("Add header/footer image")
    .setInputFiles({ name: "Second.png", mimeType: "image/png", buffer: logo });
  await expect(story.locator("img[src]")).toHaveCount(2);
  await story.press("Control+z");
  await expect(story.locator("img[src]")).toHaveCount(1);
  await dialog.press("Escape");
  stage("save reload export");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await reopen();
  await expect(sheets.first().locator("img[src]")).toHaveAttribute(
    "alt",
    "Edited company logo",
  );
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
  fs.writeFileSync(
    path.join(directory, "running-images.pdf"),
    Buffer.from(pdf.bytes),
  );
  expect(pdf.result.validation.pages).toBe(2);
  expect(pdf.result.validation.status).toBe("passed");
  await page.screenshot({ path: path.join(directory, "write.png") });
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect(page.locator(".page-card")).toHaveCount(2);
  await expect(
    page.locator(".page-card").first().locator("[data-running-story] img[src]"),
  ).toHaveAttribute("alt", "Edited company logo");
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  for (const scale of ["0.5", "1", "1.5"]) {
    await page.evaluate(
      (scale) => localStorage.setItem("alder.uiScale", scale),
      scale,
    );
    await reopen();
    await expect(sheets).toHaveCount(2);
    await expect
      .poll(() =>
        sheets
          .first()
          .locator("[data-running-story] img[src]")
          .evaluate(
            (img) =>
              img.getBoundingClientRect().width /
              img.getBoundingClientRect().height,
          ),
      )
      .toBeCloseTo(1, 1);
    await menu();
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  report.checks.push(
    "Upload/insert/undo, saved reload, Arrangement and 50/100/150% UI scales, shared PDF.",
  );
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
