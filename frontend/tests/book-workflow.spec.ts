import { openSaved } from "./openSaved";
import { test, expect } from "@playwright/test";
test.use({
  baseURL: "http://127.0.0.1:5173",
  viewport: { width: 1600, height: 1100 },
  launchOptions: { channel: "msedge" },
});
test.setTimeout(90_000);

test("continuous chapter text flows, page moves preserve words, and edits survive reopening", async ({
  page,
  request,
}) => {
  const created = await (
    await request.post("http://127.0.0.1:8765/api/projects", {
      data: { name: `Book flow ${Date.now()}`, template: "blank" },
    })
  ).json();
  await page.goto("/");
  await page.evaluate((id) => {
    localStorage.setItem("alder.project", id);
    localStorage.setItem("alder.view", "Write");
    localStorage.setItem("alder.browserOpen", "false");
    localStorage.setItem("alder.detailOpen", "false");
  }, created.id);
  await page.reload();
  await openSaved(page);
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await expect(editor).toBeVisible();
  const text = Array.from({ length: 750 }, (_, i) => `word${i}`).join(" ");
  await editor.fill(text);
  await expect
    .poll(() => page.locator(".page-navigation button").count())
    .toBeGreaterThan(1);
  await expect(editor).toHaveText(text);
  await page.getByRole("tab", { name: "Pages", exact: true }).click();
  await expect
    .poll(() => page.locator(".page-card").count())
    .toBeGreaterThan(1);
  const before = await page.locator(".page-card").first().innerText();
  await page
    .getByRole("button", { name: "Move page 1 later", exact: true })
    .click();
  await expect
    .poll(() => page.locator(".page-card").first().innerText())
    .not.toBe(before);
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const saved = await (
    await request.get(`http://127.0.0.1:8765/api/projects/${created.id}`)
  ).json();
  const allWords = saved.book.chapters[0].text.trim().split(/\s+/).sort();
  expect(allWords).toEqual(text.split(" ").sort());
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await page.reload();
  await openSaved(page);
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("word749");
  await page.screenshot({ path: "work/book-writing.png", fullPage: true });
});

test("new chapters own prose and SAPI reading follows spoken words", async ({
  page,
  request,
}) => {
  const created = await (
    await request.post("http://127.0.0.1:8765/api/projects", {
      data: { name: `Reader ${Date.now()}`, template: "blank" },
    })
  ).json();
  await page.goto("/");
  await page.evaluate((id) => {
    localStorage.setItem("alder.project", id);
    localStorage.setItem("alder.view", "Write");
    localStorage.setItem("alder.browserOpen", "false");
    localStorage.setItem("alder.detailOpen", "false");
  }, created.id);
  await page.reload();
  await openSaved(page);
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await editor.fill(
    "Alder is a place to write books. The words flow across pages while we read.",
  );
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const choices = await page
    .locator(
      'select[aria-label="Reading voice"] optgroup[label="Windows SAPI"] option',
    )
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));
  test.skip(!choices.length, "No SAPI voice is installed on this host.");
  await page.getByLabel("Reading voice").selectOption(choices[0]);
  await page
    .locator(".document-reader")
    .getByRole("button", { name: "Read", exact: true })
    .click();
  await expect(page.locator(".reading-word").first()).toBeVisible({
    timeout: 45_000,
  });
  await page
    .getByRole("button", { name: "Pause reading", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume reading", exact: true }),
  ).toBeVisible();
  const jobs = await (
    await request.get(`http://127.0.0.1:8765/api/projects/${created.id}/speech`)
  ).json();
  expect(jobs.jobs[0].engine).toBe("sapi");
  expect(jobs.jobs[0].chunks[0].wordTimings.length).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Stop reading", exact: true }).click();
  await page
    .getByRole("button", { name: "Add chapter", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Chapter title")).toHaveValue("Chapter 2");
  await editor.fill("An independent second chapter.");
  await page
    .getByRole("button", { name: "Open chapter Section 1", exact: true })
    .click();
  await expect(editor).toContainText("Alder is a place");
});

test("Chatterbox timing follows the saved chapter and stops highlighting changed wording", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const created = await (
    await request.post("http://127.0.0.1:8765/api/projects", {
      data: { name: `Chatterbox reading ${Date.now()}`, template: "blank" },
    })
  ).json();
  await page.goto("/");
  await page.evaluate((id) => {
    localStorage.setItem("alder.project", id);
    localStorage.setItem("alder.view", "Write");
    localStorage.setItem("alder.detailOpen", "false");
    localStorage.setItem("alder.browserOpen", "false");
  }, created.id);
  await page.reload();
  await openSaved(page);
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await editor.fill("The words on this page tell a story.");
  await page
    .locator(".document-reader")
    .getByRole("button", { name: "Read", exact: true })
    .click();
  await expect(page.locator(".reading-word").first()).toBeVisible({
    timeout: 120_000,
  });
  await page
    .getByRole("button", { name: "Pause reading", exact: true })
    .click();
  const jobs = await (
    await request.get(`http://127.0.0.1:8765/api/projects/${created.id}/speech`)
  ).json();
  expect(jobs.jobs[0].chunks[0].wordTimings.length).toBeGreaterThan(4);
  expect(jobs.jobs[0].chunks[0].timingSource).toBe("local-recognition");
  await editor.fill("The chapter has changed since the recording.");
  await expect(page.locator(".reading-word")).toHaveCount(0);
  await expect(page.locator(".document-reader")).toContainText(
    "The text changed after rendering",
  );
});

test("opening a rich text file adds readable chapter text without replacing the book", async ({
  page,
  request,
}) => {
  const created = await (
    await request.post("http://127.0.0.1:8765/api/projects", {
      data: { name: `RTF import ${Date.now()}`, template: "blank" },
    })
  ).json();
  await page.goto("/");
  await page.evaluate((id) => {
    localStorage.setItem("alder.project", id);
    localStorage.setItem("alder.view", "Write");
  }, created.id);
  await page.reload();
  await openSaved(page);
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await editor.fill("Keep the original chapter.");
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Open document", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "Reading sample.rtf",
    mimeType: "application/rtf",
    buffer: Buffer.from(
      "{\\rtf1\\ansi A new document to read.\\par A second paragraph.}",
    ),
  });
  await expect(editor).toContainText("A new document to read.");
  await expect(
    page.getByRole("button", { name: "Open chapter Section 1", exact: true }),
  ).toBeVisible();
});
