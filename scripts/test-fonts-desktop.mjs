import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
import { desktopExecutable } from "./desktop-paths.mjs";
const stamp = Date.now();
const packaged = process.argv.includes("--packaged");
const app = await electron.launch({
  executablePath: desktopExecutable(packaged),
  args: [
    ...(packaged ? [] : ["."]),
    "--headless-test",
    `--user-data-dir=${path.resolve(`work/fonts-ui-${stamp}`)}`,
  ],
  env: {
    ...process.env,
    ALDER_DATA_DIR: path.resolve(`work/fonts-data-${stamp}`),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Chapter text editor", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [...document.fonts].filter(
            (font) =>
              font.family.replaceAll('"', "") === "Liberation Serif" &&
              font.status === "loaded",
          ).length,
      ),
    )
    .toBe(4);
  await expect(
    page.getByRole("combobox", { name: "Font family", exact: true }).first(),
  ).toHaveValue("Liberation Serif");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const projectName = await page.evaluate(async () => {
    const id = localStorage.getItem("alder.project");
    const project = await window.alder.request("GET", `/api/projects/${id}`);
    project.settings.fontFamily = "Alder Missing Font Fixture";
    await window.alder.request("PUT", `/api/projects/${id}`, {
      expectedRevision: project.revision,
      project,
    });
    return project.name;
  });
  await page.reload();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page
    .locator(".start-open")
    .getByRole("button", { name: projectName, exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("combobox", { name: "Font family", exact: true }).first(),
  ).toHaveValue("Alder Missing Font Fixture");
  await expect(
    page.getByRole("combobox", { name: "Font family", exact: true }).first(),
  ).toHaveAttribute("title", /unavailable/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          [...document.fonts].filter(
            (font) =>
              font.family.replaceAll('"', "") ===
                "Alder Missing Font Fixture" && font.status === "loaded",
          ).length,
      ),
    )
    .toBe(4);
  const font = await page.evaluate(
    async () =>
      (
        await window.alder.request(
          "GET",
          `/api/projects/${localStorage.getItem("alder.project")}`,
        )
      ).settings.fontFamily,
  );
  expect(font).toBe("Alder Missing Font Fixture");
  console.log(
    JSON.stringify({
      ok: true,
      bundledFacesLoaded: 4,
      missingFontLabel: true,
      authoredFontPreserved: true,
    }),
  );
} finally {
  await app.close();
}
