import { _electron as electron, expect } from "@playwright/test";
import { desktopExecutable } from "./desktop-paths.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const profile = await fs.mkdtemp(path.join(os.tmpdir(), "alder-txt-desktop-"));
const filename = path.join(profile, "Native Fixture.txt");
const report = { status: "running", checks: [], errors: [] };
let app;
const encodingOnly = process.argv.includes("--encoding-only");
try {
  await fs.writeFile(filename, "alpha\r\nbeta\r\n");
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [
      ".",
      "--headless-test",
      `--user-data-dir=${path.join(profile, "profile")}`,
    ],
    env: {
      ...process.env,
      ALDER_DATA_DIR: path.join(profile, "data"),
      ALDER_RESOURCES_DIR: path.resolve("work/bundle-resources"),
    },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "TXT text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  if (!encodingOnly) {
    await editor.fill("This is mispelled.");
    await expect(editor.locator(".annotation-spelling")).toBeVisible();
    await editor.locator(".annotation-spelling").hover();
    const hover = page.getByRole("dialog", {
      name: "Review underlined issue",
      exact: true,
    });
    await expect(hover).toBeVisible();
    await hover
      .getByRole("button", { name: "Use “misspelled”", exact: true })
      .click();
    await expect(editor).toHaveText("This is misspelled.");
    await editor.press("Control+z");
    await expect(editor).toHaveText("This is mispelled.");
    report.checks.push("TXT spelling hover correction and undo");
  }
  await page
    .locator('input[aria-label="Open documents"]')
    .setInputFiles(filename);
  await expect(
    page.getByRole("tab", { name: "Native Fixture", exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveText("alphabeta");
  const originalId = await page.evaluate(() =>
    localStorage.getItem("alder.project"),
  );
  const bound = await page.evaluate(
    (id) => window.alder.documentFileInfo(id),
    originalId,
  );
  expect(bound.path).toBe(filename);
  expect(bound.changed).toBe(false);
  report.checks.push("native source binding");
  if (!encodingOnly) {
    await editor.press("Control+Home");
    await editor.pressSequentially("Edited ");
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await editor.press("Control+s");
    await expect
      .poll(() => fs.readFile(filename, "utf8"))
      .toBe("Edited alpha\r\nbeta\r\n");
    report.checks.push("native save preserves CRLF and final newline");
    await editor.press("Control+z");
    await expect(editor).toHaveText("alphabeta");
    await editor.press("Control+y");
    await expect(editor).toHaveText("Edited alphabeta");
    report.checks.push("undo/redo after native save");
    await editor.fill("./Native");
    await editor.press("Control+End");
    await editor.press("Control+Alt+Space");
    await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
      "Native Fixture.txt",
    );
    await editor.press("Enter");
    await expect(editor).toContainText("Native Fixture.txt");
    await editor.fill("Edited alpha\nbeta\n");
    report.checks.push("manual filesystem path completion");
    await page.getByRole("button", { name: "Text tools", exact: true }).click();
    await page.getByRole("button", { name: "File tools", exact: true }).click();
    await fs.writeFile(filename, "External wording\r\n");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByText("This file changed outside Alder.", { exact: false }),
    ).toBeVisible();
    report.checks.push("external change detection");
    await page
      .getByRole("button", { name: "Compare with disk", exact: true })
      .click();
    const comparison = page.getByRole("dialog", {
      name: "Compare text",
      exact: true,
    });
    await expect(comparison).toBeVisible();
    await expect(comparison.locator(".cm-mergeView")).toContainText(
      "External wording",
    );
    await comparison
      .getByRole("button", { name: "Close comparison", exact: true })
      .click();
    report.checks.push("disk comparison");
    await page
      .getByRole("button", { name: "Reload disk file in new tab", exact: true })
      .click();
    await expect(editor).toHaveText("External wording");
    const reopenedId = await page.evaluate(() =>
      localStorage.getItem("alder.project"),
    );
    expect(reopenedId).not.toBe(originalId);
    const original = await page.evaluate(
      (id) => window.alder.request("GET", `/api/projects/${id}`),
      originalId,
    );
    expect(original.book.chapters[0].text).toBe("Edited alpha\nbeta\n");
    report.checks.push("reload preserves original working copy");
    await page
      .getByRole("button", { name: "Monitor file", exact: true })
      .click();
    const monitor = page.getByRole("dialog", {
      name: "Monitor TXT file",
      exact: true,
    });
    await expect(monitor).toContainText("External wording");
    await fs.appendFile(filename, "Appended line\r\n");
    await expect(monitor).toContainText("Appended line");
    await monitor
      .getByRole("button", { name: "Close monitor", exact: true })
      .click();
    report.checks.push("read-only log monitor observes appends");
  } else {
    await page.getByRole("button", { name: "Text tools", exact: true }).click();
    await page.getByRole("button", { name: "File tools", exact: true }).click();
  }
  await fs.writeFile(filename, "字 café\r\n", "utf16le");
  await page
    .getByRole("combobox", { name: "Reopen TXT encoding", exact: true })
    .selectOption("utf-16-le");
  await page
    .getByRole("button", {
      name: "Reopen using encoding in new tab",
      exact: true,
    })
    .click();
  await expect(editor).toHaveText("字 café");
  const encodingId = await page.evaluate(() =>
    localStorage.getItem("alder.project"),
  );
  const encoded = await page.evaluate(
    (id) => window.alder.request("GET", `/api/projects/${id}`),
    encodingId,
  );
  expect(encoded.settings.textFile.encoding).toBe("utf-16-le");
  expect(encoded.settings.textFile.bom).toBe(false);
  report.checks.push("explicit BOM-less UTF-16 reopen in a separate workspace");
  if (!encodingOnly && !process.argv.includes("--editor-only")) {
    const folder = path.join(profile, "folder");
    await fs.mkdir(folder);
    const first = path.join(folder, "a.txt"),
      second = path.join(folder, "b.txt");
    const firstBytes = Buffer.concat([
        Buffer.from([239, 187, 191]),
        Buffer.from("😀 old\r\n"),
      ]),
      secondBytes = Buffer.from("caf\xe9 old\r\n", "binary");
    await fs.writeFile(first, firstBytes);
    await fs.writeFile(second, secondBytes);
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selected],
      });
    }, folder);
    await page.getByRole("button", { name: "Text tools", exact: true }).click();
    await page
      .getByRole("button", { name: "Folder workspace", exact: true })
      .click();
    const workspace = page.locator(".txt-folder-workspace");
    await workspace.locator("summary").click();
    await workspace
      .getByRole("button", { name: "Choose folder", exact: true })
      .click();
    await expect(workspace.getByRole("status")).toContainText("2 files");
    await workspace
      .getByRole("textbox", { name: "Find in folder", exact: true })
      .fill("old");
    await workspace
      .getByRole("textbox", { name: "Folder replacement text", exact: true })
      .fill("new");
    await workspace
      .getByRole("button", { name: "Find in files", exact: true })
      .click();
    await expect(workspace.getByRole("status")).toContainText(
      "2 matches in 2 files",
    );
    await workspace
      .getByRole("button", { name: "Preview folder replacement", exact: true })
      .click();
    await expect(workspace.getByRole("status")).toContainText(
      "Prepared 2 files",
    );
    expect(await fs.readFile(first)).toEqual(firstBytes);
    expect(await fs.readFile(second)).toEqual(secondBytes);
    await workspace
      .getByRole("button", { name: "Write verified replacements", exact: true })
      .click();
    await expect(workspace.getByRole("status")).toContainText(
      "2 of 2 files written",
    );
    expect(await fs.readFile(first)).toEqual(
      Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from("😀 new\r\n")]),
    );
    expect(await fs.readFile(second)).toEqual(
      Buffer.from("caf\xe9 new\r\n", "binary"),
    );
    await fs.writeFile(second, "Newer authored work");
    await workspace
      .getByRole("button", { name: "Restore last replacement", exact: true })
      .click();
    await expect(workspace.getByRole("status")).toContainText(
      "Restored 1 files",
    );
    expect(await fs.readFile(first)).toEqual(firstBytes);
    expect(await fs.readFile(second, "utf8")).toBe("Newer authored work");
    report.checks.push(
      "folder preview/write preserves UTF BOM, CRLF and legacy encoding; recovery refuses newer work",
    );
    await fs.writeFile(path.join(folder, "slow.txt"), "a".repeat(10000) + "!");
    await workspace
      .getByRole("textbox", { name: "Workspace file filters", exact: true })
      .fill("slow.txt");
    await workspace
      .getByRole("combobox", { name: "Folder search mode", exact: true })
      .selectOption("regex");
    await workspace
      .getByRole("textbox", { name: "Find in folder", exact: true })
      .fill("(a+)+$");
    await workspace
      .getByRole("button", { name: "Find in files", exact: true })
      .click();
    await expect(workspace.getByRole("status")).toContainText("too long");
    report.checks.push(
      "catastrophic folder regex times out in disposable worker",
    );
  }
  expect(report.errors).toEqual([]);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.errors.push(error.stack || String(error));
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  const output = path.join(os.tmpdir(), "alder-txt-desktop-report.json");
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: output }, null, 2));
  // Delete only the freshly created temporary profile, never user application data.
  if (
    path.dirname(profile) === path.resolve(os.tmpdir()) &&
    path.basename(profile).startsWith("alder-txt-desktop-")
  )
    await fs.rm(profile, { recursive: true, force: true });
}
