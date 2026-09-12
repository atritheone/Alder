import { openSaved } from "./openSaved";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// These tests use the real Vite/Python application and real project persistence.
// Start the development servers on 127.0.0.1:5173 and :8765 before running them.
test.use({
  baseURL: "http://127.0.0.1:5173",
  viewport: { width: 1600, height: 1000 },
  launchOptions: { channel: "msedge" },
  trace: "retain-on-failure",
  actionTimeout: 15_000,
});
test.describe.configure({ timeout: 60_000 });

async function saved(page: Page) {
  await expect(page.locator(".save-status")).toHaveText("Saved", {
    timeout: 15_000,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
}

async function menu(page: Page, name: string, item: string) {
  await page
    .locator(".menubar")
    .getByRole("button", { name, exact: true })
    .click();
  await page
    .locator(".menu-popup")
    .getByRole("button", { name: item, exact: true })
    .click();
}

async function createProject(page: Page, label: string) {
  const name = `E2E ${label} ${Date.now()}`;
  const project = await (
    await page.request.post("http://127.0.0.1:8765/api/projects", {
      data: { name, template: "blank" },
    })
  ).json();
  await page.goto("/");
  await page.evaluate((id) => {
    localStorage.setItem("alder.project", id);
    localStorage.setItem("alder.browserOpen", "true");
    localStorage.setItem("alder.detailOpen", "true");
  }, project.id);
  await page.reload();
  await openSaved(page);
  await saved(page);
  return {
    id: project.id as string,
    initialClips: project.clips.length as number,
    initialPlacements: project.placements.length as number,
  };
}

async function insertPrimeIdea(page: Page) {
  await page.getByRole("button", { name: "Prime", exact: true }).click();
  const idea = page
    .locator(".library-item")
    .filter({ has: page.getByText("I", { exact: true }) });
  await expect(idea).toHaveCount(1);
  // Use the actual browser drag/drop route, including its DataTransfer payload.
  await idea.dragTo(
    page.getByRole("textbox", { name: "Chapter text editor", exact: true }),
  );
  await expect(
    page.getByRole("textbox", { name: "Chapter text editor" }),
  ).toHaveText("I");
  await saved(page);
}

async function replaceText(page: Page, text: string) {
  const editor = page.getByRole("textbox", { name: "Chapter text editor" });
  await editor.fill(text);
  await expect(editor).toHaveText(text);
  await saved(page);
}

test("sandbox experiments stay independent when copied into a chapter and exported", async ({
  page,
  request,
}) => {
  const { id } = await createProject(page, "independent sandbox");
  await replaceText(page, "A book begins here.");
  const sandbox = page.getByRole("textbox", {
    name: "Sandbox text editor",
    exact: true,
  });
  await sandbox.fill("An independent experiment.");
  await page
    .getByRole("button", { name: "Insert into chapter", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Chapter text editor", exact: true }),
  ).toContainText("An independent experiment.");
  await sandbox.fill("The experiment changed.");
  await saved(page);
  const p = await (
    await request.get(`http://127.0.0.1:8765/api/projects/${id}`)
  ).json();
  expect(p.book.chapters[0].text).toContain("An independent experiment.");
  expect(p.book.chapters[0].text).not.toContain("The experiment changed.");
  expect(
    p.clips.some((c: { text: string }) => c.text === "The experiment changed."),
  ).toBe(true);
  const result = await (
    await request.post(`http://127.0.0.1:8765/api/projects/${id}/export`, {
      data: { format: "txt" },
    })
  ).json();
  const text = await (
    await request.get("http://127.0.0.1:8765" + result.downloadUrl)
  ).text();
  expect(text).toContain("An independent experiment.");
  expect(text).not.toContain("The experiment changed.");
});

test("project dictionary definitions are saved and available in the word sandbox", async ({
  page,
  request,
}) => {
  const { id } = await createProject(page, "dictionary");
  await insertPrimeIdea(page);
  await replaceText(page, "Aldercraft gives language a useful shape.");
  await menu(page, "Edit", "Project dictionary…");
  await page.getByRole("button", { name: "Add word…", exact: true }).click();
  await page.getByLabel("Word", { exact: true }).fill("Aldercraft");
  await page
    .getByLabel("Definition", { exact: true })
    .fill("The careful shaping of language in a shared writing workspace.");
  await page.getByRole("button", { name: "Add word", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "dictionary" })).toContainText(
    "Aldercraft",
  );
  await page
    .getByRole("dialog", { name: "dictionary" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await saved(page);
  await page.getByLabel("Explore word", { exact: true }).fill("Aldercraft");
  await page.getByRole("button", { name: "Definition", exact: true }).click();
  await expect(page.locator(".word-results")).toContainText(
    "The careful shaping of language in a shared writing workspace.",
  );
  const persisted = await (
    await request.get(`http://127.0.0.1:8765/api/projects/${id}`)
  ).json();
  expect(persisted.dictionary).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        word: "Aldercraft",
        definition:
          "The careful shaping of language in a shared writing workspace.",
      }),
    ]),
  );
  await expect(
    page.getByRole("textbox", { name: "Chapter text editor" }),
  ).toHaveText("Aldercraft gives language a useful shape.");
});

test("legacy frozen wording migrates into a chapter without changing archived drafts", async ({
  page,
  request,
}) => {
  const p = await (
    await request.post("http://127.0.0.1:8765/api/projects", {
      data: { name: `Migration ${Date.now()}`, template: "blank" },
    })
  ).json();
  const doc = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  p.clips[0].document = doc("A living draft.");
  p.placements[0].frozenDocument = doc("The preserved quotation.");
  await request.put(`http://127.0.0.1:8765/api/projects/${p.id}`, {
    data: { project: p, expectedRevision: p.revision },
  });
  await page.goto("/");
  await page.evaluate((id) => {
    localStorage.setItem("alder.project", id);
    localStorage.setItem("alder.view", "Write");
  }, p.id);
  await page.reload();
  await openSaved(page);
  await expect(
    page.getByRole("textbox", { name: "Chapter text editor", exact: true }),
  ).toHaveText("The preserved quotation.");
  await replaceText(page, "An edited book chapter.");
  const savedProject = await (
    await request.get(`http://127.0.0.1:8765/api/projects/${p.id}`)
  ).json();
  expect(savedProject.clips[0].text).toBe("A living draft.");
  expect(savedProject.placements[0].frozenText).toBe(
    "The preserved quotation.",
  );
  expect(savedProject.book.chapters[0].text).toBe("An edited book chapter.");
});

test("definition cards save authored meaning and download a real 800 pixel PNG", async ({
  page,
  request,
}) => {
  const { id } = await createProject(page, "definition card");
  await menu(page, "Create", "Definition card…");
  const studio = page.getByRole("dialog", { name: "Definition cards" });
  await studio.getByLabel("Headword", { exact: true }).fill("Aldercraft");
  await studio
    .getByLabel("Pronunciation · IPA", { exact: true })
    .fill("/ˈɔːl.də.krɑːft/");
  await studio.getByLabel(/^Part of speech/).fill("Noun");
  await studio
    .getByLabel("Definition", { exact: true })
    .fill("The deliberate shaping of language into a living work.");
  await studio
    .getByRole("button", { name: "Save definition", exact: true })
    .click();
  await expect(studio).toContainText("Definition added to this project.");
  await saved(page);
  const persisted = await (
    await request.get(`http://127.0.0.1:8765/api/projects/${id}`)
  ).json();
  expect(persisted.dictionary).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        word: "Aldercraft",
        ipa: "/ˈɔːl.də.krɑːft/",
        partOfSpeech: "Noun",
        definition: "The deliberate shaping of language into a living work.",
      }),
    ]),
  );

  await studio
    .getByRole("button", { name: "Preview card", exact: true })
    .click();
  const preview = studio.getByRole("img", {
    name: "Rendered definition card for Aldercraft",
  });
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() =>
      preview.evaluate(
        (node: HTMLImageElement) => node.complete && node.naturalWidth === 800,
      ),
    )
    .toBe(true);
  const downloadPromise = page.waitForEvent("download");
  await studio.getByRole("button", { name: "Export PNG", exact: true }).click();
  const artifact = await downloadPromise;
  expect(artifact.suggestedFilename()).toMatch(/\.png$/i);
  const png = await readFile((await artifact.path())!);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(800);
  expect(png.readUInt32BE(20)).toBe(800);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a rejected short voice reference explains the error and preserves the writing", async ({
  page,
  request,
}) => {
  await createProject(page, "voice validation");
  await replaceText(
    page,
    "My writing remains safe when a voice reference is rejected.",
  );
  const before = (
    await (await request.get("http://127.0.0.1:8765/api/speech/voices")).json()
  ).voices.length;
  await menu(page, "Read", "Voices and pronunciation…");
  const manager = page.getByRole("dialog", { name: "voices" });
  const pcm = Buffer.alloc(44 + 8000 * 2); // Deliberately invalid one-second reference fixture.
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(pcm.length - 8, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(8000, 24);
  pcm.writeUInt32LE(16000, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(16000, 40);
  const picker = page.waitForEvent("filechooser");
  await manager
    .getByRole("button", { name: "Add reference voice…", exact: true })
    .click();
  await (
    await picker
  ).setFiles({
    name: "too-short-reference.wav",
    mimeType: "audio/wav",
    buffer: pcm,
  });
  await expect(page.getByRole("alert")).toContainText(
    /longer than (5|five) seconds/,
    { timeout: 15_000 },
  );
  const after = (
    await (await request.get("http://127.0.0.1:8765/api/speech/voices")).json()
  ).voices.length;
  expect(after).toBe(before);
  await manager
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Dismiss error", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Chapter text editor" }),
  ).toHaveText("My writing remains safe when a voice reference is rejected.");
  await saved(page);
});

test("local narration checks spoken content and displays a waveform from real audio", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const capabilities = await (
    await request.get("http://127.0.0.1:8765/api/speech/capabilities")
  ).json();
  expect(
    capabilities.available,
    "A complete Alder resource bundle must include local speech.",
  ).toBe(true);
  expect(
    capabilities.verification?.available,
    "A complete Alder resource bundle must include CPU content checking.",
  ).toBe(true);
  const { id } = await createProject(page, "verified narration");
  await replaceText(page, "An idea takes shape.");
  await page.getByLabel("Variation seed", { exact: true }).fill("900");
  await page.getByRole("tab", { name: "Narration", exact: true }).click();
  await page.getByLabel("Check spoken words locally", { exact: true }).check();
  await page
    .getByLabel("Narration format", { exact: true })
    .selectOption("wav");
  await page.getByText("Speech options", { exact: true }).click();
  await page
    .getByLabel("Narration boundary pause", { exact: true })
    .fill("0.35");
  await page
    .getByLabel("Content-check retries", { exact: true })
    .selectOption("0");
  await page.getByRole("button", { name: "Render book", exact: true }).click();
  const job = page
    .locator(".job")
    .filter({ hasText: "An idea takes shape." })
    .first();
  await expect(job.locator(".job-status").first()).toHaveText("ready", {
    timeout: 120_000,
  });
  await expect(job).toContainText("content checked");
  await job.getByText("Review chunks and wording", { exact: true }).click();
  await job.locator(".narration-chunk-review>summary").first().click();
  await expect(job.locator(".narration-wording dd").nth(0)).toHaveText(
    "An idea takes shape.",
  );
  await expect(job.locator(".narration-wording dd").nth(1)).toHaveText(
    "An idea takes shape.",
  );
  await expect(job.locator(".narration-wording dd").nth(2)).toContainText(
    /An idea takes shape\.?/i,
  );
  await expect(job).toContainText("Word error rate: 0.0%");
  await job.getByRole("button", { name: "Show waveform", exact: true }).click();
  await expect(
    job.getByRole("img", { name: "Waveform of the saved narration" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(job.getByLabel("Seek within this narration")).toHaveAttribute(
    "max",
    /^[1-9]\d*(\.\d+)?$/,
  );
  const artifactPromise = page.waitForEvent("download");
  await job.getByRole("button", { name: "Save WAV", exact: true }).click();
  const wav = await readFile((await (await artifactPromise).path())!);
  expect(wav.subarray(0, 4).toString()).toBe("RIFF");
  expect(wav.subarray(8, 12).toString()).toBe("WAVE");
  expect(wav.length).toBeGreaterThan(24000);
  expect(wav.subarray(44).some((byte) => byte !== 0)).toBe(true);
  const snapshot = await (
    await request.get(`http://127.0.0.1:8765/api/projects/${id}/speech`)
  ).json();
  const rendered = snapshot.jobs[0];
  expect(rendered.settings.pauseSeconds).toBe(0.35);
  expect(rendered.verificationRetries).toBe(0);
  await job
    .getByLabel("Review note for chunk 1", { exact: true })
    .fill("The selected take has been listened to in context.");
  await job.getByLabel("I listened to chunk 1", { exact: true }).check();
  await job
    .getByRole("button", {
      name: "Accept chunk 1 after listening",
      exact: true,
    })
    .click();
  await expect(job).toContainText("Listening acceptance: 1 of 1 chunks.");
  const reviewed = await (
    await request.get(`http://127.0.0.1:8765/api/speech/jobs/${rendered.id}`)
  ).json();
  expect(reviewed.manualReviewStatus).toBe("accepted");
  expect(reviewed.chunks[0].manualReview.note).toBe(
    "The selected take has been listened to in context.",
  );
  expect(reviewed.chunks[0].manualReview.audioHash).toMatch(/^[a-f0-9]{64}$/);
  expect(reviewed.chunks[0].qa).toEqual(rendered.chunks[0].qa);
  await page.reload();
  await openSaved(page);
  await saved(page);
  await page.getByRole("tab", { name: "Narration", exact: true }).click();
  await job.getByText("Review chunks and wording", { exact: true }).click();
  await expect(job).toContainText("Listening acceptance: 1 of 1 chunks.");
  await job.locator(".narration-chunk-review>summary").first().click();
  await job
    .getByRole("button", { name: "Revoke acceptance of chunk 1", exact: true })
    .click();
  await expect(job).toContainText("Listening acceptance: 0 of 1 chunks.");
  await job.getByRole("button", { name: "Show waveform", exact: true }).click();
  await expect(
    job.getByRole("img", { name: "Waveform of the saved narration" }),
  ).toBeVisible();
  const divider = await page.locator(".horizontal-resizer").boundingBox();
  if (divider) {
    await page.mouse.move(
      divider.x + divider.width / 2,
      divider.y + divider.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(divider.x + divider.width / 2, 320, { steps: 8 });
    await page.mouse.up();
  }
  await page.screenshot({
    path: test.info().outputPath("narration-review.png"),
    fullPage: true,
  });
});
