import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const resource = require("resedit");
const executable = path.resolve("node_modules/electron/dist/Alder.exe");
const resources = resource.NtExecutableResource.from(
  resource.NtExecutable.from(fs.readFileSync(executable)),
);
const groups = resource.Resource.IconGroupEntry.fromEntries(resources.entries);
expect(groups).toHaveLength(1);
const expected = resource.Data.IconFile.from(
  fs.readFileSync("build/alder.ico"),
).icons;
const actual = groups[0].getIconItemsFromEntries(resources.entries);
expect(actual).toHaveLength(7);
for (let i = 0; i < actual.length; i++)
  expect(Buffer.from(actual[i].bin)).toEqual(Buffer.from(expected[i].data.bin));
const version = resource.Resource.VersionInfo.fromEntries(
  resources.entries,
)[0].getStringValues({ lang: 1033, codepage: 1200 });
expect(version.ProductName).toBe("Alder");
expect(version.FileDescription).toContain("Alder");
const app = await electron.launch({
  executablePath: executable,
  args: [
    ".",
    "--headless-test",
    `--user-data-dir=${path.resolve(`work/branding-ui-${Date.now()}`)}`,
  ],
  env: {
    ...process.env,
    ALDER_DATA_DIR: path.resolve(`work/branding-data-${Date.now()}`),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(page.locator(".start-brand .alder-logo img")).toBeVisible();
  expect(
    await page
      .locator(".start-brand img")
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  ).toBe(true);
  await expect(
    page.locator('link[rel="icon"][type="image/x-icon"]'),
  ).toHaveAttribute("href", /\/branding\/alder\.ico$/);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".window-brand .alder-logo img")).toBeVisible();
  await expect(page.locator(".window-brand .alder-logo img")).toHaveAttribute(
    "src",
    "/branding/alder-logo-black.png",
  );
  await expect(page.locator(".window-brand .alder-logo")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await page
    .getByRole("textbox", { name: "Chapter text editor", exact: true })
    .fill("Alder carries its own mark.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await expect(page.locator(".save-status .saved-dot")).toBeVisible();
  const accent = await page
    .getByLabel("Reading speed slider", { exact: true })
    .evaluate((el) => getComputedStyle(el).accentColor);
  expect(accent).toBe("rgb(61, 117, 187)");
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "About Alder", exact: true })
    .click();
  await expect(page.locator(".about-panel .alder-logo img")).toBeVisible();
  await expect(page.locator(".about-panel svg")).toHaveCount(0);
  const icon = await app.evaluate(async ({ app }) => {
    const image = await app.getFileIcon(process.execPath, { size: "large" });
    return image.toPNG().toString("base64");
  });
  fs.writeFileSync("work/alder-windows-icon.png", Buffer.from(icon, "base64"));
  const screenshot = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      )
    )
      .toPNG()
      .toString("base64"),
  );
  fs.writeFileSync(
    "work/alder-branding.png",
    Buffer.from(screenshot, "base64"),
  );
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      iconSizes: actual.length,
      product: version.ProductName,
      accent,
      saved: "Saved",
      errors,
    }),
  );
} finally {
  await app.close();
}
