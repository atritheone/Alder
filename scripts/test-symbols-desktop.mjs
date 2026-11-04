import { _electron as electron, expect as baseExpect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const expect = baseExpect.configure({ timeout: 20000 }),
  directory = path.resolve("work/symbols-ui"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "alder-symbols-"));
fs.mkdirSync(directory, { recursive: true });
const report = { status: "running", errors: [] };
let app, page;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
    env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("button", { name: "Word Document", exact: false })
    .click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
      name: "Chapter text editor",
      exact: true,
    }),
    tools = page.locator(".book-main .format-toolbar");
  const show = async (toolbar) => {
    await toolbar
      .getByRole("button", { name: "More formatting", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Insert symbol…", exact: true })
      .click();
  };
  const picker = page.getByRole("dialog", {
    name: "Insert symbol",
    exact: true,
  });
  await editor.fill("Write OLD tail.");
  await editor.press("Control+Home");
  for (let i = 0; i < 6; i++) await editor.press("ArrowRight");
  for (let i = 0; i < 3; i++) await editor.press("Shift+ArrowRight");
  await tools.getByRole("button", { name: "Bold", exact: true }).click();
  await show(tools);
  await picker
    .getByLabel("Search symbols", { exact: true })
    .fill("capital letter omega");
  await picker
    .getByRole("button", {
      name: "Greek capital letter omega, U+03A9",
      exact: true,
    })
    .click();
  await picker.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(editor).toHaveText("Write Ω tail.");
  await expect(editor.locator("strong")).toHaveText("Ω");
  await editor.press("Control+z");
  await expect(editor).toHaveText("Write OLD tail.");
  await editor.press("Control+y");
  await expect(editor).toHaveText("Write Ω tail.");
  await editor.press("Control+End");
  const toggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  const sandbox = page.getByRole("textbox", {
      name: "Sandbox text editor",
      exact: true,
    }),
    sandboxTools = page.locator(".detail-pane .format-toolbar");
  await sandbox.fill("Draft OLD");
  await sandbox.press("Control+End");
  for (let i = 0; i < 3; i++) await sandbox.press("Shift+ArrowLeft");
  // Write still owns its insertion point while Sandbox has the global selection.
  await show(tools);
  await picker
    .getByLabel("Unicode character code", { exact: true })
    .fill("U+1F642");
  await picker.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(editor).toHaveText("Write Ω tail.🙂");
  await expect(sandbox).toHaveText("Draft OLD");
  await show(sandboxTools);
  await picker
    .getByLabel("Symbol group", { exact: true })
    .selectOption("Greek");
  const alpha = picker.getByRole("button", {
    name: "Greek capital letter alpha, U+0391",
    exact: true,
  });
  await alpha.click();
  await alpha.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(sandbox).toHaveText("Draft Β");
  await expect(editor).toHaveText("Write Ω tail.🙂");
  await sandbox.press("Control+z");
  await expect(sandbox).toHaveText("Draft OLD");
  await sandbox.press("Control+y");
  await expect(sandbox).toHaveText("Draft Β");
  for (const scale of [0.5, 1, 1.5]) {
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("tab", { name: "Appearance", exact: true })
      .click();
    await settings
      .getByLabel("UI Scale", { exact: true })
      .selectOption(String(scale));
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await show(tools);
    await picker
      .getByLabel("Unicode character code", { exact: true })
      .fill("U+D800");
    await expect(
      picker.getByRole("button", { name: "Insert", exact: true }),
    ).toBeDisabled();
    const bounds = await picker.boundingBox(),
      viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    if (scale === 1)
      await page.screenshot({ path: path.join(directory, "picker.png") });
    await page.keyboard.press("Escape");
    await expect(picker).not.toBeVisible();
  }
  await expect(editor).toHaveText("Write Ω tail.🙂");
  await expect(sandbox).toHaveText("Draft Β");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.locator(".project-list-item").first().click();
  await expect(editor).toHaveText("Write Ω tail.🙂");
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  await expect(sandbox).toHaveText("Draft Β");
  await editor.press("Control+End");
  await tools.getByRole("button", {name:"More formatting",exact:true}).click();
  await page.getByRole("menuitem", {name:"Review changes…",exact:true}).click();
  const review=page.getByRole("dialog", {name:"Review changes",exact:true});
  await review.getByLabel("Review author", {exact:true}).fill("Symbol reviewer");
  await review.getByLabel("Track changes", {exact:true}).check();
  await review.getByRole("button", {name:"Done",exact:true}).click();
  await show(tools);await picker.getByLabel("Unicode character code", {exact:true}).fill("U+20AC");
  await picker.getByRole("button", {name:"Insert",exact:true}).click();
  await expect(editor.locator("[data-revision-insertion]")).toHaveText("€");
  await editor.press("Control+z");await expect(editor).toHaveText("Write Ω tail.🙂");
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
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
