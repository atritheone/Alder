import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron.exe"),
  args: [
    ".",
    "--headless-test",
    `--user-data-dir=${path.resolve(`work/write-preview-ui-${Date.now()}`)}`,
  ],
  env: {
    ...process.env,
    ALDER_DATA_DIR: path.resolve(`work/write-preview-desktop-${Date.now()}`),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const writing = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(writing).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const project = await page.evaluate(() =>
    window.alder.request(
      "GET",
      `/api/projects/${localStorage.getItem("alder.project")}`,
    ),
  );
  expect(project.clips).toHaveLength(1);
  expect(project.clips[0].text).toBe("");
  await writing.fill("Preview preserves this document.");
  await writing.press("End");
  await page.evaluate(() => {
    window.previewEditor = document.querySelector(
      '[aria-label="Chapter text editor"]',
    );
    const selection = window.getSelection();
    window.previewSelection = {
      node: selection.anchorNode,
      offset: selection.anchorOffset,
    };
  });
  await expect(
    page.getByRole("button", { name: "Preview", exact: true }),
  ).toHaveText("Preview");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Page Preview", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Write", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".publication-canvas-scroll")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 45000 },
  );
  await expect(page.locator(".publication-canvas-scroll canvas")).toBeVisible();
  await page
    .getByRole("button", { name: "Back To Write", exact: true })
    .click();
  await expect(writing).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        window.previewEditor ===
        document.querySelector('[aria-label="Chapter text editor"]'),
    ),
  ).toBe(true);
  await writing.focus();
  expect(
    await page.evaluate(() => {
      const selection = window.getSelection();
      return (
        selection.anchorNode === window.previewSelection.node &&
        selection.anchorOffset === window.previewSelection.offset
      );
    }),
  ).toBe(true);
  await writing.press("Control+Z");
  await expect(writing).toHaveText("");
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      previewInWrite: true,
      editorPreserved: true,
      selectionPreserved: true,
      undoPreserved: true,
      pdfRendered: true,
    }),
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  const timer = setTimeout(() => app.process().kill(), 10000);
  try {
    await app.close();
  } finally {
    clearTimeout(timer);
  }
}
