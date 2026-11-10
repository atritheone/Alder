import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { desktopExecutable } from "./desktop-paths.mjs";

const output = fs.mkdtempSync(path.join(os.tmpdir(), "alder-hover-examples-"));
const launch = JSON.parse(fs.readFileSync("last-build.json", "utf8"));
const cases = [
  {
    name: "01-sentence-rewrite",
    source:
      "The reason why the meeting was cancelled was due to the fact that nobody had confirmed whether they would be attending.",
  },
  {
    name: "02-grammar-repair",
    source:
      "The report which was written by the team it contains several mistakes that needs to be corrected.",
  },
  {
    name: "03-active-construction",
    source:
      "The proposal was discussed by the committee and a decision was made by them to postpone it.",
  },
];
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
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.unmaximize();
    window.setContentSize(1600, 1050);
  });
  const writing = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  const hover = page.getByRole("dialog", {
    name: "Review underlined issue",
    exact: true,
  });
  const report = page.getByRole("dialog", {
    name: "Spelling and Grammar",
    exact: true,
  });
  for (const [index, example] of cases.entries()) {
    await writing.fill(example.source);
    const underline = writing.locator(".annotation-clarity").first();
    await expect(underline).toBeVisible({ timeout: 120000 });
    await underline.hover();
    await expect(hover).toBeVisible();
    await expect(report).toBeHidden();
    const changes = hover.getByLabel("Revision changes");
    await expect(changes).toBeVisible();
    for (const label of [
      "Suggested revision",
      "Compare original",
      "Show changes",
      "Possible issue · local model",
    ])
      await expect(hover.getByText(label, { exact: true })).toHaveCount(0);
    await expect(changes.locator("xpath=ancestor::details")).toHaveCount(0);
    if (index === 0) {
      await hover
        .getByRole("button", { name: "Another version", exact: true })
        .click();
      await expect(hover.getByRole("status")).toBeVisible();
      await hover
        .getByRole("button", { name: "Ignore once", exact: true })
        .click();
      await expect(hover).toBeHidden();
      await expect(underline).toBeVisible({ timeout: 120000 });
      await underline.hover();
      await expect(hover).toBeVisible();
      await expect(hover.getByRole("status")).toBeHidden({ timeout: 120000 });
      await expect(hover).toBeVisible();
    }
    const proposal = await changes.evaluate((element) => {
      const revised = element.cloneNode(true);
      revised.querySelectorAll("del").forEach((node) => node.remove());
      return revised.textContent;
    });
    expect(proposal).not.toBe(example.source);
    await expect(changes).toBeVisible();
    await hover
      .getByRole("button", { name: "Accept rewrite", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(hover).toBeVisible();
    await page.screenshot({
      path: path.join(output, `${example.name}.png`),
      scale: "css",
    });
    await hover.screenshot({
      path: path.join(output, `${example.name}-hover.png`),
      scale: "css",
    });
    example.proposal = proposal;
    console.log(
      JSON.stringify({
        ...example,
        screenshot: path.join(output, `${example.name}-hover.png`),
      }),
    );
    await hover
      .getByRole("button", { name: "Accept rewrite", exact: true })
      .click();
    await expect(writing).toHaveText(proposal);
    await expect(hover).toBeHidden();
    await page.screenshot({
      path: path.join(output, `${example.name}-accepted.png`),
      scale: "css",
    });
    await writing.focus();
    await page.keyboard.press("Control+z");
    await expect(writing).toHaveText(example.source);
  }
  expect(errors).toEqual([]);
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        checks: [
          "hover without opening report",
          "direct sentence changes without duplicate previews or model label",
          "another version remains on hover",
          "comparison visible without a foldout",
          "accept on hover",
          "undo",
          "ignore while another version is pending",
        ],
        cases,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "passed", output }));
} catch (error) {
  const page = app.windows()[0];
  await page
    ?.screenshot({ path: path.join(output, "failure.png"), timeout: 3000 })
    .catch(() => {});
  fs.writeFileSync(path.join(output, "error.txt"), String(error.stack));
  console.error(JSON.stringify({ status: "failed", output }));
  throw error;
} finally {
  await app.close();
}
