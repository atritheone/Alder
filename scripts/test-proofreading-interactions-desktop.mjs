import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect as baseExpect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 30000 });
const output = fs.mkdtempSync(path.join(os.tmpdir(), "alder-proofreading-ui-"));
const build = JSON.parse(fs.readFileSync("last-build.json", "utf8"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${output}/profile`],
  env: {
    ...process.env,
    ALDER_DATA_DIR: `${output}/data`,
    ALDER_RESOURCES_DIR: build.resources,
    ALDER_PROOFREADING_RESOURCES: build.proofreadingResources,
  },
  timeout: 60000,
});
console.log(output);
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".start-screen")).toHaveCSS(
    "background-color",
    "rgb(225, 225, 225)",
  );
  await expect(
    page.getByRole("button", { name: "New", exact: true }),
  ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const size = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getContentSize(),
    );
  const home = await size();
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++)
      await window.alder.request("POST", "/api/projects", {
        name: `Workspace ${i}`,
        template: "blank",
      });
  });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".start-open .project-list-item")).toHaveCount(6);
  await expect.poll(async () => (await size())[1]).toBeGreaterThan(home[1]);
  await expect(page.getByRole("button", { name: /Open .alder/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Open file…" }),
  ).toBeInViewport();
  console.log("Start checks passed");
  await page.locator('.start-screen input[type="file"]').setInputFiles({
    name: "Review.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("This is mispelled. Another mispelled word."),
  });
  const writing = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(writing.locator(".annotation-spelling")).toHaveCount(2);
  console.log("Document imported and checked");
  const status = page.getByRole("button", {
    name: "Open spelling and grammar",
    exact: true,
  });
  await status.click();
  const report = page.getByRole("dialog", {
    name: "Spelling and Grammar",
    exact: true,
  });
  await expect(report.locator(".check-item[data-review-id]")).toHaveCount(2);
  await report
    .getByRole("button", { name: "Close spelling and grammar" })
    .click();
  await writing.locator(".annotation-spelling").first().click();
  await page.mouse.move(1, 1);
  const corner = page.locator(".word-results .proofreading-panel");
  await expect(corner.locator(".check-item")).toHaveCount(1);
  // Keyboard movement away from an issue must clear the corner without stealing focus.
  await writing.press("ControlOrMeta+Home");
  await expect(corner.locator(".check-item")).toHaveCount(0);
  await expect(writing).toBeFocused();
  await writing.locator(".annotation-spelling").last().hover();
  const hover = page.getByRole("dialog", { name: "Review underlined issue" });
  await expect(hover).toBeVisible();
  const hoverFontSizes = await hover.locator("button").evaluateAll(buttons => buttons.map(button => getComputedStyle(button).fontSize));
  expect(hoverFontSizes.length).toBeGreaterThan(1);
  expect(new Set(hoverFontSizes).size).toBe(1);
  await hover
    .getByRole("button", { name: "Use “misspelled”", exact: true })
    .click();
  await expect(writing).toHaveText(
    "This is mispelled. Another misspelled word.",
  );
  await expect(hover).toHaveCount(0);
  await writing.press("ControlOrMeta+z");
  await expect(writing).toHaveText(
    "This is mispelled. Another mispelled word.",
  );
  await writing.fill("I saw the the bird.");
  await expect(writing.locator(".annotation-grammar")).toBeVisible();
  await writing.locator(".annotation-grammar").hover();
  await hover.getByRole("button", { name: "Use “the”", exact: true }).click();
  await expect(writing).toHaveText("I saw the bird.");
  await page
    .getByRole("button", { name: "Toggle sandbox", exact: true })
    .evaluate((b) => {
      if (b.getAttribute("aria-expanded") !== "true") b.click();
    });
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await sandbox.fill("This is mispelled.");
  await expect(sandbox.locator(".annotation-spelling")).toBeVisible();
  await sandbox.locator(".annotation-spelling").hover();
  await hover
    .getByRole("button", { name: "Use “misspelled”", exact: true })
    .click();
  await expect(sandbox).toHaveText("This is misspelled.");
  await expect(writing).toHaveText("I saw the bird.");
  console.log("Caret, hover, grammar, undo, and Sandbox checks passed");
  // Opening a saved bundle uses exactly the same file input as text documents.
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const archive = await page.evaluate(async (folder) => {
    const id = localStorage.getItem("alder.project");
    return window.alder.request("POST", `/api/projects/${id}/save`, {
      path: `${folder}/Review.alder`,
    });
  }, output);
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator('.start-screen input[type="file"]')
    .setInputFiles(archive.path);
  await expect(writing).toHaveText("I saw the bird.");
  await status.click();
  await expect(report).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(report).toHaveCount(0);
  // Review all chapters, including findings outside the current editor.
  await page.reload();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("button", { name: "Book Chapters & pages", exact: true })
    .click();
  await page.locator('input[name="chapters"]').fill("2");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await writing.fill("This is mispelled.");
  await page
    .getByRole("button", { name: "Open chapter Chapter 2", exact: true })
    .click();
  await writing.fill("Another mispelled word.");
  await status.click();
  await expect(report.locator(".book-proofreading-results > li")).toHaveCount(
    2,
  );
  await expect(
    report.locator(".book-proofreading-results .check-item"),
  ).toHaveCount(1);
  await report
    .locator(".book-proofreading-results .check-item button")
    .first()
    .click();
  await expect(report).toHaveCount(0);
  await expect(writing).toHaveText("This is mispelled.");
  await expect(corner.locator(".check-item")).toHaveCount(1);
  await corner
    .getByRole("button", { name: "Use “misspelled”", exact: true })
    .click();
  await expect(writing).toHaveText("This is misspelled.");
  // Report corrections and scaled hover placement remain usable at both extremes.
  await writing.fill("This is mispelled.");
  await status.click();
  await report
    .locator(".check-item[data-review-id]")
    .getByRole("button", { name: "Use “misspelled”", exact: true })
    .click();
  await expect(writing).toHaveText("This is misspelled.");
  await page.keyboard.press("Escape");
  for (const scale of [0.5, 1.5]) {
    await page.evaluate(
      (value) =>
        document.documentElement.style.setProperty("--ui-scale", String(value)),
      scale,
    );
    await writing.fill("This is mispelled.");
    await expect(writing.locator(".annotation-spelling")).toBeVisible();
    await writing.locator(".annotation-spelling").hover();
    await expect(hover).toBeInViewport();
    await hover
      .getByRole("button", { name: "Use “misspelled”", exact: true })
      .click();
    await expect(writing).toHaveText("This is misspelled.");
  }
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      status: "passed",
      checks: [
        "start colour and flat buttons",
        "Open resize",
        "unified txt/alder opening",
        "full report",
        "caret-only corner",
        "keyboard caret",
        "hover spelling and grammar fixes",
        "undo",
        "sandbox isolation",
        "Escape",
        "multi-chapter report and navigation",
        "corrections from report",
        "50% and 150% hover scale",
      ],
    }),
  );
} catch (error) {
  const page = app.windows()[0];
  await page
    ?.screenshot({ path: `${output}/failure.png`, timeout: 3000 })
    .catch(() => {});
  fs.writeFileSync(`${output}/error.txt`, String(error.stack));
  throw error;
} finally {
  await app.close();
}
