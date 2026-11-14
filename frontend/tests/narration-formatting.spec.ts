import { test, expect } from "@playwright/test";

test.use({
  baseURL: process.env.ALDER_TXT_TEST_URL || "http://127.0.0.1:4173",
  viewport: { width: 1440, height: 1000 },
  launchOptions: { channel: "msedge" },
});

const audio = Buffer.alloc(44 + 8000 * 10 * 2);
audio.write("RIFF");
audio.writeUInt32LE(audio.length - 8, 4);
audio.write("WAVEfmt ", 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write("data", 36);
audio.writeUInt32LE(audio.length - 44, 40);

for (const kind of ["txt", "docx", "book", "md"]) {
  test(`${kind}: narration hides formatting marks and restores saved preferences`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("alder.structure.write", "true");
      localStorage.setItem("alder.structure.sandbox", "true");
      localStorage.setItem("alder.txt.whitespace", "true");
    });
    let requested!: () => void, release!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const allowAudio = new Promise<void>((resolve) => {
      release = resolve;
    });
    let job: unknown;
    await page.route("**/api/speech/prepare", (route) =>
      route.fulfill({ json: { ready: true } }),
    );
    await page.route("**/api/projects/*/speech", async (route) => {
      const body = route.request().postDataJSON();
      requested();
      await allowAudio;
      job = {
        id: "formatting-fixture",
        projectId: new URL(route.request().url()).pathname.split("/")[3],
        status: "ready",
        text: body.text,
        progress: 1,
        message: "Ready",
        eventSequence: 0,
        sourceRevision: 1,
        createdAt: new Date().toISOString(),
        seconds: 10,
        settings: { pauseSeconds: 0 },
        chunks: [
          {
            id: "chunk",
            text: body.text,
            status: "ready",
            playbackEligible: true,
            sourceStart: 0,
            sourceEnd: Array.from(body.text).length,
            seconds: 10,
            startSeconds: 0,
            audioUrl: "/api/speech/jobs/formatting-fixture/chunks/chunk.wav",
            wordTimings: [
              {
                text: body.text.split(/\s/)[0],
                sourceStart: 0,
                sourceEnd: 1,
                startSeconds: 0,
                endSeconds: 10,
              },
            ],
          },
        ],
      };
      await route.fulfill({ json: job });
    });
    await page.route(
      "**/api/speech/jobs/formatting-fixture**",
      async (route) => {
        const url = route.request().url();
        if (url.endsWith(".wav"))
          await route.fulfill({ contentType: "audio/wav", body: audio });
        else
          await route.fulfill({
            json: url.includes("/events") ? { sequence: 0, events: [] } : job,
          });
      },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "New", exact: true }).click();
    if (kind === "docx")
      await page
        .getByRole("button", { name: "Word document .docx", exact: true })
        .click();
    if (kind === "book")
      await page
        .getByRole("button", { name: "Book Chapters & pages", exact: true })
        .click();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(
      page.getByRole("textbox", {
        name:
          kind === "txt" || kind === "md"
            ? "TXT text editor"
            : "Chapter text editor",
        exact: true,
      }),
    ).toBeVisible();
    if (kind === "md") {
      await page
        .locator('input[aria-label="Open documents"]')
        .setInputFiles({
          name: "Narration.md",
          mimeType: "text/markdown",
          buffer: Buffer.from(
            "# Narration heading\n\nA **bold** document with *emphasis*.\n\n- First item\n- Second item\n",
          ),
        });
      const rich = page.getByRole("textbox", {
        name: "Chapter text editor",
        exact: true,
      });
      await expect(rich.locator("h1")).toHaveText("Narration heading");
      await expect(rich.locator("strong")).toHaveText("bold");
      await expect(rich.locator("em")).toHaveText("emphasis");
      await expect(rich.locator("li")).toHaveCount(2);
      await expect(
        page.getByRole("textbox", { name: "TXT text editor", exact: true }),
      ).toHaveCount(0);
      const rawToggle = page
        .locator(".book-editor")
        .getByRole("button", { name: "Raw", exact: true });
      await rawToggle.click();
      const raw = page.getByRole("textbox", {
        name: "Raw text editor",
        exact: true,
      });
      await expect(raw).toContainText("**bold**");
      await raw.fill(
        "# Updated heading\n\nA **bold** document with *emphasis*.\n\n- First item\n- Second item\n",
      );
      await rawToggle.click();
      await expect(rich.locator("h1")).toHaveText("Updated heading");
      await expect(rich.locator("strong")).toHaveText("bold");
    }
    const editor = page.getByRole("textbox", {
      name: kind === "txt" ? "TXT text editor" : "Chapter text editor",
      exact: true,
    });
    if (kind !== "md") await editor.fill("Narration  example.\nSecond\tline.");
    const toolbar = page.locator(".book-editor .format-toolbar");
    const formatting = toolbar.getByRole("button", {
      name: kind === "txt" ? "Show whitespace" : "Show structure",
      exact: true,
    });
    await expect(formatting).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Toggle sandbox", exact: true })
      .evaluate((button) => {
        if (button.getAttribute("aria-expanded") !== "true")
          (button as HTMLButtonElement).click();
      });
    const sandbox = page
      .getByRole("textbox", { name: "Sandbox text editor", exact: true })
      .locator(
        'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " editor-shell ")]',
      );
    const sandboxFormatting = sandbox.getByRole("button", {
      name: "Show structure",
      exact: true,
    });
    await expect(sandboxFormatting).toHaveAttribute("aria-pressed", "true");
    await editor.press("Control+Home");
    const reader = page.locator(".book-main > .reader-reveal .document-reader");
    await reader
      .getByRole("button", { name: "Play Reading", exact: true })
      .click();
    await requestStarted;
    try {
      await expect(formatting).toHaveAttribute("aria-pressed", "false");
      await expect(formatting).toBeDisabled();
      await expect(sandboxFormatting).toHaveAttribute("aria-pressed", "false");
      if (kind === "txt")
        await expect(
          page.locator(
            ".book-editor .cm-highlightSpace,.book-editor .cm-highlightTab",
          ),
        ).toHaveCount(0);
      else
        await expect(page.locator(".book-editor .show-structure")).toHaveCount(
          0,
        );
    } finally {
      release();
    }
    await expect
      .poll(() =>
        reader
          .locator("audio")
          .evaluate((element: HTMLAudioElement) => element.paused),
      )
      .toBe(false);
    await expect(formatting).toHaveAttribute("aria-pressed", "false");
    await expect(sandboxFormatting).toHaveAttribute("aria-pressed", "false");
    if (kind === "md")
      await expect(editor.locator("strong")).toHaveText("bold");
    await reader
      .getByRole("button", { name: "Stop reading", exact: true })
      .click();
    await expect(formatting).toHaveAttribute("aria-pressed", "true");
    await expect(formatting).toBeEnabled();
    await expect(sandboxFormatting).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(() => [
        localStorage.getItem("alder.structure.write"),
        localStorage.getItem("alder.structure.sandbox"),
        localStorage.getItem("alder.txt.whitespace"),
      ]),
    ).toEqual(["true", "true", "true"]);
  });
}
