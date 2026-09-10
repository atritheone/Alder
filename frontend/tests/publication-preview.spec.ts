import { test, expect } from "@playwright/test";

test.use({
  baseURL: "http://127.0.0.1:5173",
  viewport: { width: 1600, height: 1100 },
  launchOptions: { channel: "msedge" },
});
test.describe.configure({ timeout: 60_000 });

test("PDF proof renders real exported pages and reading controls preserve source", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", {
    data: { name: `Publication proof ${Date.now()}`, template: "book" },
  });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  project.settings.header = "Alder publication proof";
  project.settings.footer = true;
  project.settings.chapterPageBreaks = true;
  project.clips[0].document = {
    type: "doc",
    content: Array.from({ length: 45 }, (_, index) => ({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: `Passage ${index + 1}. A word becomes a phrase, and a phrase becomes a world. We gather language, read it aloud, and preserve the words that matter.`,
        },
      ],
    })),
  };
  const stored = await request.put(`/api/projects/${project.id}`, {
    data: { project, expectedRevision: project.revision },
  });
  expect(stored.ok()).toBeTruthy();
  const saved = await stored.json();
  await page.addInitScript((id) => {
    localStorage.setItem("alder.project", id);
    localStorage.setItem("alder.view", "Sandbox");
    localStorage.setItem("alder.browserOpen", "false");
    localStorage.setItem("alder.detailOpen", "false");
  }, project.id);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".project-label strong")).toHaveText(project.name);
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/projects/${project.id}/export`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("tab", { name: "Page Preview", exact: true }).click();
  const proof = await (await response).json();
  expect(proof.sourceRevision).toBe(saved.revision + 1);
  expect(proof.validation.pages).toBeGreaterThan(1);
  const canvas = page.locator(".publication-canvas-scroll canvas");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".publication-page-text p")).toContainText(
    "Passage 1.",
    { timeout: 30_000 },
  );
  expect(
    await canvas.evaluate((element: HTMLCanvasElement) => {
      const bytes = element
        .getContext("2d")!
        .getImageData(0, 0, element.width, element.height).data;
      let dark = 0;
      for (let i = 0; i < bytes.length; i += 4)
        if (
          bytes[i] < 150 &&
          bytes[i + 1] < 150 &&
          bytes[i + 2] < 150 &&
          bytes[i + 3] > 0
        )
          dark++;
      return dark;
    }),
  ).toBeGreaterThan(1000);
  await page.screenshot({ path: "work/publication-preview-print.png" });
  await page.getByLabel("Next PDF page").click();
  await expect(page.getByLabel("PDF page number")).toHaveValue("2");
  await page.getByLabel("PDF zoom").selectOption("1");
  await expect(page.locator(".publication-page-text p")).not.toHaveText("");
  await page
    .getByRole("button", { name: "Reflowable reading", exact: true })
    .click();
  const reading = page.frameLocator(
    'iframe[title="Reflowable publication preview"]',
  );
  await expect(reading.locator("body")).toContainText("Passage 1.");
  await page.getByLabel("Reading preview type size").selectOption("24");
  await expect(reading.locator("body")).toHaveCSS("font-size", "24px");
  await page.getByLabel("Reading preview width").selectOption("360");
  await expect(
    page.locator('iframe[title="Reflowable publication preview"]'),
  ).toHaveCSS("width", "360px");
  await page
    .getByLabel("Reading preview contents")
    .selectOption({ label: "Afterword" });
  await expect(reading.locator("#section-2")).toBeInViewport();
  await page.screenshot({ path: "work/publication-preview-reading.png" });
  const finalProject = await (
    await request.get(`/api/projects/${project.id}`)
  ).json();
  expect(finalProject.revision).toBe(saved.revision + 1);
  expect(finalProject.clips[0].document).toEqual(saved.clips[0].document);
  expect(errors).toEqual([]);
  await expect(page.locator(".publication-error")).toHaveCount(0);
});

test("failed PDF generation can be retried without losing the project", async ({
  page,
  request,
}) => {
  const project = await (
    await request.post("/api/projects", {
      data: { name: `Proof retry ${Date.now()}`, template: "demo" },
    })
  ).json();
  await page.addInitScript((id) => {
    localStorage.setItem("alder.project", id);
    localStorage.setItem("alder.view", "Sandbox");
  }, project.id);
  await page.route(`**/api/projects/${project.id}/export`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Test publication service interruption" }),
    }),
  );
  await page.goto("/");
  await expect(page.locator(".project-label strong")).toHaveText(project.name);
  await page.getByRole("tab", { name: "Page Preview", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Test publication service interruption",
  );
  await page.unroute(`**/api/projects/${project.id}/export`);
  await page
    .getByRole("button", { name: "Retry saved collation", exact: true })
    .click();
  await expect(page.locator(".publication-page-text p")).toContainText(
    "I keep a small collection",
    { timeout: 30_000 },
  );
  expect(
    (await (await request.get(`/api/projects/${project.id}`)).json()).revision,
  ).toBe(project.revision + 1);
});
