import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { desktopExecutable } from "./desktop-paths.mjs";

const output = fs.mkdtempSync(
  path.join(os.tmpdir(), "alder-sentence-revisions-"),
);
const launch = JSON.parse(fs.readFileSync("last-build.json", "utf8"));
const app = await electron.launch({
  executablePath: desktopExecutable(),
  args: [".", "--headless-test", `--user-data-dir=${path.join(output, "ui")}`],
  env: {
    ...process.env,
    ALDER_RESOURCES_DIR: launch.resources,
    ALDER_PROOFREADING_RESOURCES: launch.proofreadingResources,
    ALDER_DATA_DIR: path.join(output, "data"),
  },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const writing = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const source =
    "The reason why the meeting was cancelled was due to the fact that nobody had confirmed whether they would be attending.";
  await writing.fill(source);
  await page
    .getByRole("button", { name: "Open spelling and grammar", exact: true })
    .click();
  const report = page.getByRole("dialog", {
    name: "Spelling and Grammar",
    exact: true,
  });
  await expect(
    report.getByText("Suggested revision", { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await writing.click();
  await expect(writing).toBeFocused();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("The train arrived before noon.", { delay: 20 });
  const retained = await writing
    .locator(".annotation-clarity")
    .allTextContents();
  expect(
    retained.some((text) => text.includes("The reason why the meeting")),
  ).toBe(true);
  const baseline = await writing.innerText();
  await report
    .getByRole("button", { name: "Another version", exact: true })
    .first()
    .click();
  await expect(
    report.getByText("Suggested revision", { exact: true }),
  ).toBeHidden();
  await expect(
    report.getByText("Suggested revision", { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await report.getByText("Show changes", { exact: true }).first().click();
  await expect(report.getByLabel("Revision changes")).toBeVisible();
  const modelProposal = await report
    .locator(".sentence-revision-preview > p")
    .nth(1)
    .innerText();
  const adjusted =
    "The meeting was cancelled because nobody had confirmed whether they would attend.";
  await report.getByText("Edit revision", { exact: true }).first().click();
  await report
    .getByLabel("Edit proposed sentence revision", { exact: true })
    .fill(adjusted);
  await page.screenshot({
    path: path.join(output, "revision-preview.png"),
    fullPage: true,
  });
  await report
    .getByRole("button", { name: "Accept rewrite", exact: true })
    .first()
    .click();
  await expect.poll(() => writing.innerText()).not.toBe(baseline);
  await expect(writing).toContainText(adjusted);
  const revised = await writing.innerText();
  await report
    .getByRole("button", { name: "Close spelling and grammar", exact: true })
    .click();
  await writing.focus();
  await page.keyboard.press("Control+z");
  await expect.poll(() => writing.innerText()).toBe(baseline);
  await page
    .getByRole("button", { name: "Open spelling and grammar", exact: true })
    .click();
  await report
    .getByRole("checkbox", {
      name: "Suggest sentence structure and clarity improvements",
      exact: true,
    })
    .uncheck();
  await report
    .getByRole("button", { name: "Close spelling and grammar", exact: true })
    .click();
  await writing.focus();
  await page.keyboard.press("Control+Home");
  const explicitSource =
    "The proposal was discussed by the committee and a decision was made by them to postpone it.";
  await writing.fill(explicitSource);
  await page.keyboard.press("F7");
  await expect(report).toBeVisible();
  await expect(
    report.getByText("Suggested revision", { exact: true }),
  ).toBeVisible({ timeout: 120000 });
  expect(errors).toEqual([]);
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        checks: [
          "automatic local sentence revision",
          "non-modal writing",
          "retained sentence revision while typing in another paragraph",
          "another version",
          "word-level comparison",
          "editable sentence preview",
          "F7 explicit revision with automatic suggestions disabled",
          "complete preview",
          "accept rewrite",
          "one-step undo",
        ],
        source,
        modelProposal,
        explicitSource,
        revised,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "passed", output, revised }));
} finally {
  await app.close();
}
