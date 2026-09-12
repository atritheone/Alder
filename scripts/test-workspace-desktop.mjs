import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron.exe"),
  args: [
    ".",
    "--headless-test",
    `--user-data-dir=${path.resolve(`work/workspace-ui-${Date.now()}`)}`,
  ],
  env: {
    ...process.env,
    ALDER_DATA_DIR: path.resolve(`work/workspace-desktop-${Date.now()}`),
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
  await expect(page.locator(".save-status")).toHaveText("All changes saved");
  const project = await page.evaluate(() =>
    window.alder.request(
      "GET",
      `/api/projects/${localStorage.getItem("alder.project")}`,
    ),
  );
  expect(project.clips).toHaveLength(1);
  expect(project.clips[0].text).toBe("");
  const left = page.getByRole("button", {
    name: "Toggle Left Panel",
    exact: true,
  });
  if ((await left.getAttribute("aria-expanded")) === "true") await left.click();
  const centre = await page
    .locator(".paginated-editor .editor-scroll")
    .evaluate((el) => {
      const box = el.getBoundingClientRect(),
        sheet = el.querySelector(".page-sheet").getBoundingClientRect();
      return {
        left: sheet.left - box.left,
        right: box.right - sheet.right,
        width: el.clientWidth,
        css: getComputedStyle(el).cssText,
        canvas: el.querySelector(".flow-canvas").getAttribute("style"),
      };
    });

  expect(Math.abs(centre.left - centre.right)).toBeLessThan(5);
  await writing.fill(
    "The page stays centered as the manuscript grows. ".repeat(200),
  );
  await expect
    .poll(() => page.locator(".page-sheet").count())
    .toBeGreaterThan(1);
  await page
    .getByRole("navigation", { name: "Chapter pages" })
    .getByRole("button", { name: "Page 2", exact: true })
    .click();
  await expect
    .poll(() =>
      page.locator(".paginated-editor .editor-scroll").evaluate((el) => {
        const box = el.getBoundingClientRect(),
          sheet = el.querySelectorAll(".page-sheet")[1].getBoundingClientRect();
        return Math.abs(sheet.left - box.left - (box.right - sheet.right));
      }),
    )
    .toBeLessThan(5);
  await writing.fill("");
  await page
    .locator(".paginated-editor .editor-scroll")
    .evaluate((el) => el.scrollTo(0, 0));
  for (const name of ["Write", "Pages", "Page Preview"]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await expect(tab).toHaveText("");
    await expect(tab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await page.getByRole("button", { name: "Toggle help area" }).click();
  await page.getByRole("tab", { name: "Page Preview", exact: true }).hover();
  const help = page.getByLabel("Context help", { exact: true });
  await expect(help).toContainText("Preview exported PDF");
  const helpBox = await help.boundingBox(),
    root = await page.locator(".alder-app").boundingBox();
  expect(helpBox.x + helpBox.width).toBeGreaterThan(root.x + root.width - 20);
  expect(helpBox.width).toBeLessThan(root.width / 2);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).hover();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "File", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await writing.hover();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await left.click();
  const browser = page.getByRole("complementary", { name: "Language browser" });
  const old = await browser.boundingBox();
  const handle = page.getByRole("separator", { name: "Resize Left Panel" });
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 30, { steps: 8 });
  await page.mouse.up();
  expect((await browser.boundingBox()).width).toBeGreaterThan(old.width + 70);
  await browser.getByRole("button", { name: "Voices", exact: true }).click();
  await expect(
    browser.getByRole("region", { name: "Voice Management" }),
  ).toBeVisible();
  await expect(
    browser.getByRole("button", { name: "Add reference voice…", exact: true }),
  ).toBeVisible();
  await browser.getByLabel("Written Word Or Expression").fill("Alder");
  await browser.getByLabel("Speak As").fill("All der");
  await browser
    .getByRole("button", { name: "Add Pronunciation", exact: true })
    .click();
  await expect(browser.locator(".dictionary-row")).toContainText("All der");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(browser.getByText("Manage voices", { exact: true })).toHaveCount(
    0,
  );
  const sandboxToggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await sandboxToggle.getAttribute("aria-expanded")) === "false")
    await sandboxToggle.click();
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Sandbox", exact: true })
    .click();
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await expect(sandbox).toBeVisible();
  for (const word of ["I", "want", "to", "write"]) {
    const transfer = await page.evaluateHandle((word) => {
      const dt = new DataTransfer();
      dt.setData("application/x-alder-idea", JSON.stringify({ word }));
      return dt;
    }, word);
    const at = await sandbox.locator("p").last().boundingBox();
    await sandbox.dispatchEvent("drop", {
      dataTransfer: transfer,
      clientX: at.x + at.width - 15,
      clientY: at.y + at.height / 2,
    });
    await transfer.dispose();
  }
  await expect(sandbox).toHaveText("I want to write");
  await expect(page.locator(".save-status")).toHaveText("All changes saved");
  const saved = await page.evaluate(() =>
    window.alder.request(
      "GET",
      `/api/projects/${localStorage.getItem("alder.project")}`,
    ),
  );
  expect(saved.clips[0].text.trim()).toBe("I want to write");
  expect(saved.book.chapters[0].text).toBe("");
  const accent = await page
    .getByLabel("Reading speed slider", { exact: true })
    .evaluate((el) => getComputedStyle(el).accentColor);
  expect(accent).toBe("rgb(119, 81, 168)");
  expect(errors).toEqual([]);
  fs.writeFileSync(
    "work/workspace-desktop-result.json",
    JSON.stringify({ ok: true, centre, helpBox, accent, errors }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, centre, helpBox, accent, errors }));
  const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
    const picture =
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      );
    return picture.toPNG().toString("base64");
  });
  fs.writeFileSync(
    "work/workspace-desktop.png",
    Buffer.from(screenshot, "base64"),
  );
} finally {
  await app.close();
}
