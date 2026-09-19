import { desktopExecutable } from "./desktop-paths.mjs";
import { _electron as electron, expect as baseExpect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
const expect = baseExpect.configure({ timeout: 30000 });

const output = path.resolve(
  process.env.ALDER_PROOFREADING_TEST_OUTPUT ||
    `work/proofreading-test-${Date.now()}`,
);
fs.mkdirSync(output, { recursive: true });
// Exercise the actual resource selection recorded by start.cmd. The default
// test must not rely on developer-only proofreading environment overrides.
const launch = JSON.parse(fs.readFileSync("last-build.json", "utf8"));
const fallback = process.argv.includes("--missing-pack");
const launchEnv = {
  ...process.env,
  ALDER_RESOURCES_DIR: launch.resources,
  ALDER_PROOFREADING_RESOURCES: fallback
    ? path.join(output, "missing-pack")
    : launch.proofreadingResources,
  ALDER_DATA_DIR: path.join(output, "data"),
};
delete launchEnv.ALDER_PROOFREADING_PYTHON;
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${path.join(output, "ui")}`],
  env: launchEnv,
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const status = page.getByRole("button", {
    name: "Open spelling and grammar",
    exact: true,
  });
  await expect(status).toBeVisible();
  await status.click();
  const panel = page.getByRole("region", {
    name: "Spelling and grammar review",
  });
  await expect(panel).toBeVisible();
  const writing = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await writing.fill("This is a mispelled word.");
  await expect(writing.locator(".annotation-spelling")).toContainText(
    "mispelled",
  );
  await expect(writing.locator(".annotation-spelling")).toHaveCSS(
    "background-image",
    /linear-gradient/,
  );
  await page.screenshot({
    path: path.join(output, "spelling-underlines.png"),
    fullPage: true,
  });
  await writing.locator(".annotation-spelling").click();
  await expect(panel).toBeVisible();
  if (fallback) {
    await expect(status).toContainText("basic only");
    await expect(panel).toContainText(
      "Full grammar and dialect checks were not performed",
    );
    await panel
      .getByRole("button", { name: "Use “misspelled”", exact: true })
      .click();
    await expect(writing).toHaveText("This is a misspelled word.");
    await page.screenshot({
      path: path.join(output, "proofreading-fallback.png"),
      fullPage: true,
    });
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify(
        {
          status: "passed",
          checks: [
            "visible basic status",
            "fallback spelling underline",
            "fallback correction",
            "incomplete grammar warning",
          ],
        },
        null,
        2,
      ),
    );
  } else {
    await panel
      .getByRole("combobox", { name: "Proofreading dialect" })
      .selectOption("en-AU");
    await panel
      .getByRole("button", { name: "Use “misspelled”", exact: true })
      .click();
    await expect(writing).toHaveText("This is a misspelled word.");
    await writing.press("ControlOrMeta+z");
    await expect(writing).toHaveText("This is a mispelled word.");
    await writing.fill("I saw the the bird.");
    await expect(writing.locator(".annotation-grammar")).toBeVisible();
    await page.screenshot({
      path: path.join(output, "grammar-underlines.png"),
      fullPage: true,
    });
    await expect(
      panel.getByRole("button", { name: "Use “the”", exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Use “the”", exact: true }).click();
    await expect(writing).toHaveText("I saw the bird.");
    await writing.fill("This is mispelled.");
    await writing.press("ControlOrMeta+a");
    await panel
      .getByRole("button", { name: "Check selected text", exact: true })
      .click();
    await expect(panel).toContainText("Scope: Selected text.");
    await panel
      .getByRole("button", { name: "Use “misspelled”", exact: true })
      .click();
    await expect(writing).toHaveText("This is misspelled.");
    await writing.fill("She go to the shops yesterday.");
    await panel
      .getByRole("button", { name: "Advanced review", exact: true })
      .click();
    await expect(panel.locator('[data-review-engine="model"]')).toHaveCount(1, {
      timeout: 120000,
    });
    await panel
      .locator('[data-review-engine="model"]')
      .getByRole("button", { name: /Use|Apply linked/ })
      .click();
    await expect(writing).toHaveText("She went to the shops yesterday.");
    await panel
      .getByRole("button", { name: "Check spelling and grammar", exact: true })
      .click();
    await panel.getByText("Whole book review", { exact: true }).click();
    await panel
      .getByRole("button", { name: "Check whole book", exact: true })
      .click();
    await expect(panel).toContainText("Book review finished.");
    const sandbox = page.getByRole("textbox", {
      name: "Sandbox text editor",
      exact: true,
    });
    await sandbox.fill("This is mispelled.");
    await expect(sandbox.locator(".annotation-spelling")).toContainText(
      "mispelled",
    );
    await panel
      .getByRole("button", { name: "Use “misspelled”", exact: true })
      .click();
    await expect(sandbox).toHaveText("This is misspelled.");
    await expect(writing).toHaveText("She went to the shops yesterday.");
    await expect(page.locator(".save-status")).toHaveText("Saved");
    await page.screenshot({
      path: path.join(output, "proofreading.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify(
        {
          status: "passed",
          checks: [
            "inline review",
            "dialect",
            "replacement",
            "undo",
            "repeated word",
            "selection",
            "real model",
            "book review",
            "sandbox isolation",
          ],
        },
        null,
        2,
      ),
    );
    console.log(`Proofreading desktop checks passed: ${output}`);
  }
} catch (error) {
  const page = app.windows()[0];
  if (page) {
    console.error(
      await page
        .locator(".proofreading-panel, .proofreading-status")
        .allTextContents(),
    );
    await page.screenshot({
      path: path.join(output, "failure.png"),
      fullPage: true,
    });
  }
  throw error;
} finally {
  await app.close();
}
