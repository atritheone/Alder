import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-crop-"));
const directory = path.resolve("work/image-crop");
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", checks: [] };
const stage = (value) => {
  report.stage = value;
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
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Cropped picture");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  stage("collect original");
  await page.evaluate(async () => {
    const id = localStorage.getItem("alder.project");
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#aa0000";
    ctx.fillRect(0, 0, 120, 60);
    ctx.fillStyle = "#23405e";
    ctx.fillRect(30, 0, 60, 60);
    const bytes = Uint8Array.from(atob(canvas.toDataURL().split(",")[1]), (c) =>
      c.charCodeAt(0),
    );
    const asset = await window.alder.upload(
      `/api/projects/${id}/assets`,
      "Crop.png",
      Array.from(bytes),
      {},
    );
    const project = await window.alder.request("GET", `/api/projects/${id}`);
    project.book.chapters[0].document = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Before " },
            {
              type: "inline_image",
              attrs: {
                assetId: asset.id,
                src: asset.url,
                width: 160,
                alt: "Crop fixture",
              },
            },
            { type: "text", text: " after." },
          ],
        },
      ],
    };
    await window.alder.request("PUT", `/api/projects/${id}`, {
      project,
      expectedRevision: project.revision,
    });
  });
  const reopen = async () => {
    await page.reload();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator(".project-list-item")
      .filter({ hasText: "Cropped picture" })
      .click();
  };
  await reopen();
  const image = editor.getByRole("img", { name: "Crop fixture", exact: true });
  await expect(image).toBeVisible();
  const ratio = () => image.evaluate((i) => i.naturalWidth / i.naturalHeight);
  await expect.poll(ratio).toBe(2);
  stage("apply crop");
  await image.dblclick();
  const dialog = page.getByRole("dialog", {
    name: "Image properties",
    exact: true,
  });
  await dialog.locator("summary").filter({ hasText: "Crop" }).click();
  await dialog.getByLabel("Crop left (%)", { exact: true }).fill("25");
  await dialog.getByLabel("Crop right (%)", { exact: true }).fill("25");
  await page.screenshot({ path: path.join(directory, "properties.png") });
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(editor).toBeFocused();
  await expect.poll(ratio).toBe(1);
  await expect(editor).toHaveText("Before  after.");
  await editor.press("Control+z");
  await expect.poll(ratio).toBe(2);
  await editor.press("Control+y");
  await expect.poll(ratio).toBe(1);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const crop = await image.getAttribute("data-image-crop");
  expect(JSON.parse(crop)).toEqual({ left: 25, top: 0, right: 25, bottom: 0 });
  await reopen();
  await expect.poll(ratio).toBe(1);
  report.checks.push(
    "Apply returns focus; cropped pixels, one-step undo/redo, autosave and reopen retain the original asset and surrounding prose.",
  );
  stage("remove and clipboard");
  await image.dblclick();
  await dialog.locator("summary").filter({ hasText: "Crop" }).click();
  await dialog.getByLabel("Crop left (%)", { exact: true }).fill("80");
  await expect(
    dialog.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Remove crop", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(ratio).toBe(2);
  await editor.press("Control+z");
  await expect.poll(ratio).toBe(1);
  const html = await editor.innerHTML();
  await editor.press("Control+End");
  await editor.evaluate((element, html) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", "Before  after.");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, html);
  await expect(image).toHaveCount(2);
  const sources = await image.evaluateAll((images) =>
    images.map((i) => ({
      crop: i.getAttribute("data-image-crop"),
      source: i.getAttribute("data-image-source"),
      ratio: i.naturalWidth / i.naturalHeight,
    })),
  );
  expect(sources[0]).toEqual(sources[1]);
  await editor.press("Control+z");
  await expect(image).toHaveCount(1);
  report.checks.push(
    "Invalid crops cannot apply; Remove crop and undo restore original/crop; copying retains crop and original source.",
  );
  stage("raw source round trip");
  const identity = await image.getAttribute("data-object-id");
  const rawToggle = page.getByRole("button", { name: "Raw", exact: true });
  await rawToggle.click();
  const raw = page.getByRole("textbox", {
    name: "Raw text editor",
    exact: true,
  });
  const source = await raw.innerText();
  expect(source).toContain('data-image-placement="inline"');
  expect(source).toContain("data-image-crop=");
  expect(source).not.toContain("alder://");
  await raw.fill(source.replace("Before ", "Before edited "));
  await rawToggle.click();
  await expect(image).toHaveAttribute("data-object-id", identity);
  await expect.poll(ratio).toBe(1);
  await expect(editor).toHaveText("Before edited  after.");
  report.checks.push(
    "Editing Raw HTML retains inline placement, crop, original resource and object identity.",
  );
  stage("caption follows picture drag");
  await image.click();
  await page
    .getByRole("button", { name: "More formatting", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Insert caption…", exact: true })
    .click();
  const captionDialog = page.getByRole("dialog", {
    name: "Insert caption",
    exact: true,
  });
  await captionDialog
    .getByLabel("Caption text", { exact: true })
    .fill("A cropped picture");
  await captionDialog
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await editor.press("End");
  await editor.press("Enter");
  await page.keyboard.type("Target paragraph.");
  await expect(editor.locator("[data-caption-label]")).toHaveCount(1);
  const target = editor.locator("p").filter({ hasText: "Target paragraph." });
  await image.dragTo(target, { targetPosition: { x: 8, y: 12 } });
  await expect(target.locator("img")).toHaveCount(1);
  const order = await editor
    .locator(":scope > p")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        text: n.textContent,
        caption: n.getAttribute("data-caption-target"),
        image: !!n.querySelector("img"),
      })),
    );
  expect(order.at(-1).caption).toBe(identity);
  expect(order.at(-2).image).toBe(true);
  await editor.press("Control+z");
  await expect(target.locator("img")).toHaveCount(0);
  await expect(editor.locator("p").first().locator("img")).toHaveCount(1);
  report.checks.push(
    "An image drag carries its adjacent caption with one undo; Enter after the caption starts ordinary prose.",
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(directory, "editor.png") });
  report.status = "passed";
  stage("complete");
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  stage(report.stage);
  process.exitCode = 1;
  await page
    ?.screenshot({ path: path.join(directory, "failure.png") })
    .catch(() => {});
} finally {
  await app?.close();
}
