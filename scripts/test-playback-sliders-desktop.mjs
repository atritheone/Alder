import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";

const app = await electron.launch({
  executablePath: path.resolve("node_modules/electron/dist/electron.exe"),
  args: [
    ".",
    "--headless-test",
    `--user-data-dir=${path.resolve(`work/slider-ui-${Date.now()}`)}`,
  ],
  env: {
    ...process.env,
    ALDER_DATA_DIR: path.resolve(`work/slider-desktop-${Date.now()}`),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      console.log(message.type(), message.text());
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .fill(
      "Skip these words. Alder   reads each word clearly. The voice   follows the writing at a precise speed. There is plenty of time to pause, move the cursor, and continue listening without losing your place.",
    );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const families = await page.evaluate(
    async () => (await window.alder.request("GET", "/api/fonts")).families,
  );
  const fontMenu = page.getByLabel("Font family", { exact: true }).first();
  const listed = await fontMenu.locator("option").allTextContents();
  expect(families.every((family) => listed.includes(family))).toBe(true);
  expect(families.length).toBeGreaterThan(10);
  await expect(fontMenu).toHaveValue("Cambria");
  const speedInput = page.getByLabel("Reading speed", { exact: true });
  const speedSlider = page.getByRole("slider", {
    name: "Reading speed slider",
    exact: true,
  });
  await speedInput.fill("1.37");
  await speedInput.press("Tab");
  await expect(speedInput).toHaveValue("1.37");
  await expect(speedSlider).toHaveAttribute("step", "0.05");
  await expect(speedSlider).toHaveValue("1.35");
  await speedSlider.focus();
  await speedSlider.press("ArrowRight");
  await expect(speedInput).toHaveValue("1.40");
  await speedInput.fill("1.376");
  await speedInput.press("Enter");
  await expect(speedInput).toHaveValue("1.38");
  await speedInput.fill("9");
  await speedInput.press("Tab");
  await expect(speedInput).toHaveValue("3.00");
  await speedInput.fill("1.00");
  await speedInput.press("Tab");
  const scrollBefore = await page
    .locator(".book-editor .editor-scroll")
    .evaluate((el) => el.scrollTop);
  await speedSlider.hover();
  await page.mouse.wheel(0, -100);
  await expect(speedInput).toHaveValue("1.05");
  await page.mouse.wheel(0, 100);
  await expect(speedInput).toHaveValue("1.00");
  const volumeSlider = page.getByRole("slider", {
    name: "Reading volume",
    exact: true,
  });
  await volumeSlider.hover();
  await page.mouse.wheel(0, -100);
  await expect(volumeSlider).toHaveValue("2.05");
  await page.mouse.wheel(0, 100);
  await expect(volumeSlider).toHaveValue("2");
  expect(
    await page
      .locator(".book-editor .editor-scroll")
      .evaluate((el) => el.scrollTop),
  ).toBe(scrollBefore);
  const toggle = page.getByRole("button", {
    name: "Toggle sandbox",
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Narration", exact: true })
    .click();
  const narrationVolume = page.getByRole("slider", {
    name: "Narration volume",
    exact: true,
  });
  await narrationVolume.hover();
  await page.mouse.wheel(0, -100);
  await expect(narrationVolume).toHaveValue("2.05");
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Sandbox", exact: true })
    .click();
  await page
    .locator(".detail-heading")
    .getByRole("tab", { name: "Narration", exact: true })
    .click();
  await narrationVolume.hover();
  await page.mouse.wheel(0, 100);
  await expect(narrationVolume).toHaveValue("2");
  const narrationSpeed = page.getByRole("slider", {
    name: "Narration speed slider",
    exact: true,
  });
  await narrationSpeed.hover();
  await page.mouse.wheel(0, -100);
  await expect(page.getByLabel("Narration speed", { exact: true })).toHaveValue(
    "1.05",
  );
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      exactSpeed: true,
      speedSteps: 0.05,
      readingWheel: true,
      narrationWheel: true,
      remountedWheel: true,
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
