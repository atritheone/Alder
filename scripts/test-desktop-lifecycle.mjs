import { _electron as electron, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { desktopExecutable } from "./desktop-paths.mjs";
const layout = JSON.parse(
  fs.readFileSync(
    new URL("../backend/alder/runtime-layout.json", import.meta.url),
    "utf8",
  ),
)[process.platform];
const executable = desktopExecutable(process.argv.includes("--packaged"));

// Exercise the actual close/save handshake, then inspect the committed SQLite
// snapshot after the service has stopped. No installed Python or tools are used.
const packaged = process.argv.includes("--packaged");
const output = path.resolve(
  `work/${packaged ? "packaged" : "development"}-lifecycle-${Date.now()}`,
);
fs.mkdirSync(output, { recursive: true });
const resources = path.resolve(
  packaged
    ? path.resolve(
        path.dirname(executable),
        process.platform === "darwin" ? "../Resources" : "resources",
      )
    : process.env.ALDER_RESOURCES_DIR || "work/bundle-resources",
);
const env = {
  ...process.env,
  ALDER_DATA_DIR: output,
  PATH:
    process.platform === "win32"
      ? `${process.env.SystemRoot}/System32`
      : "/usr/bin:/bin",
  PYTHONNOUSERSITE: "1",
};
for (const key of ["PYTHONHOME", "PYTHONPATH", "ELECTRON_RUN_AS_NODE"])
  delete env[key];
if (!packaged) env.ALDER_RESOURCES_DIR = resources;
const app = await electron.launch({
  executablePath: executable,
  args: packaged ? ["--headless-test"] : [".", "--headless-test"],
  env,
  timeout: 60_000,
});
let closed = false;
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Book Chapters & pages" }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.getByRole("tab", { name: "Write", exact: true }).click();
  await expect.poll(() => app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.items.map(item => item.label.replaceAll("&", "")) || []
  )).toContain("File");
  const nativeMenu = await app.evaluate(({ Menu }) => {
    const items = Menu.getApplicationMenu().items;
    return { labels: items.map(item => item.label.replaceAll("&", "")),
      roles: items.map(item => item.role),
      fileRoles: items.find(item => item.label.replaceAll("&", "") === "File")?.submenu?.items.map(item => item.role) || [] };
  });
  expect(nativeMenu.labels).toContain("Edit");
  if (process.platform === "darwin") {
    expect(nativeMenu.roles[0]?.toLowerCase()).toBe("appmenu");
    expect(nativeMenu.fileRoles).not.toContain("quit");
  }
  const projectId = await page.evaluate(() =>
    localStorage.getItem("alder.project"),
  );
  const features = {};
  if (process.argv.includes("--features")) {
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator(".publication-canvas-scroll")).toHaveAttribute(
      "aria-busy",
      "false",
      { timeout: 45_000 },
    );
    await expect(
      page.locator(".publication-canvas-scroll canvas"),
    ).toBeVisible();
    await expect(page.locator(".publication-page-text")).not.toContainText(
      "contains no selectable text",
    );
    features.pdfPreview = true;
    const ink = await page
      .locator(".publication-canvas-scroll canvas")
      .evaluate((canvas) => {
        const context = canvas.getContext("2d");
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let dark = 0;
        for (let offset = 0; offset < pixels.length; offset += 28)
          if (pixels[offset] < 180 && pixels[offset + 3] > 0) dark++;
        return dark;
      });
    if (ink < 20) throw new Error("The desktop PDF canvas is blank.");
    features.exports = await page.evaluate(async (id) => {
      const outputs = [];
      for (const format of [
        "txt",
        "md",
        "html",
        "docx",
        "pdf",
        "epub",
        "azw3",
      ]) {
        const result = await window.alder.request(
          "POST",
          `/api/projects/${id}/export`,
          { format },
        );
        const response = await fetch(
          window.alder.mediaBase + result.downloadUrl,
        );
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!response.ok || !bytes.length)
          throw new Error(`Empty ${format} output`);
        outputs.push({
          format,
          bytes: bytes.length,
          validation: result.validation,
        });
      }
      const card = await window.alder.request(
        "POST",
        `/api/projects/${id}/definition-export`,
        {
          format: "png",
          entry: {
            word: "Voyager",
            ipa: "/ËˆvÉ”Éª.Éª.dÊ’É™r/",
            partOfSpeech: "Noun",
            definition: "A Priest of Lucidity and the Manifest Reality.",
          },
          options: { size: 800, dpi: 144 },
        },
      );
      const response = await fetch(window.alder.mediaBase + card.downloadUrl);
      const bitmap = await createImageBitmap(await response.blob());
      if (bitmap.width !== 800 || bitmap.height !== 800)
        throw new Error("Incorrect definition-card size.");
      bitmap.close();
      return outputs;
    }, projectId);
    features.definitionCard = "800x800 PNG";
    features.documentReader = await page.evaluate(async () => {
      const created = await window.alder.request("POST", "/api/projects", {
        name: "Packaged extraction test",
        template: "blank",
      });
      const bytes = Array.from(
        new TextEncoder().encode(
          "{\\rtf1\\ansi Alder reads rich text without external software.}",
        ),
      );
      const imported = await window.alder.upload(
        `/api/projects/${created.id}/import`,
        "sample.rtf",
        bytes,
      );
      if (!imported.clips.some((c) => c.text.includes("Alder reads rich text")))
        throw new Error("Packaged document extraction failed.");
      const voices = await window.alder.request("GET", "/api/speech/voices");
      return {
        rtf: true,
        sapiVoices: voices.voices.filter((v) => v.kind === "sapi").length,
      };
    });
    const jobId = await page.evaluate(async (id) => {
      const job = await window.alder.request(
        "POST",
        `/api/projects/${id}/speech`,
        {
          scope: "selection",
          text: "An idea takes shape.",
          seed: 900,
          verify: true,
          follow: true,
          verificationRetries: 0,
          format: "wav",
        },
      );
      return job.id;
    }, projectId);
    await expect
      .poll(
        async () =>
          page.evaluate(
            (id) =>
              window.alder
                .request("GET", `/api/speech/jobs/${id}`)
                .then((job) => job.status),
            jobId,
          ),
        { timeout: 180_000, intervals: [1000, 2000, 3000] },
      )
      .toMatch(/^(ready|failed)$/);
    features.speech = await page.evaluate(async (id) => {
      const job = await window.alder.request("GET", `/api/speech/jobs/${id}`);
      if (job.status !== "ready") throw new Error(job.error || "Speech failed");
      if (!job.chunks[0].wordTimings?.length)
        throw new Error("Packaged Chatterbox word timing is missing.");
      const response = await fetch(window.alder.mediaBase + job.audioUrl);
      const context = new AudioContext();
      const audio = await context.decodeAudioData(await response.arrayBuffer());
      const duration = audio.duration;
      await context.close();
      if (!(duration > 0)) throw new Error("No decoded narration.");
      const accepted = await window.alder.request(
        "POST",
        `/api/speech/jobs/${id}/review`,
        {
          accepted: true,
          note: "Release verification: selected take reviewed.",
        },
      );
      if (accepted.manualReviewStatus !== "accepted")
        throw new Error("Review was not persisted.");
      return {
        status: job.status,
        reviewStatus: job.reviewStatus,
        manualReviewStatus: accepted.manualReviewStatus,
        duration,
        transcript: job.chunks[0].qa?.transcript,
      };
    }, jobId);
    await page.getByRole("tab", { name: "Write", exact: true }).click();
  }
  const text = `Alder preserves the last edit before closing. ${Date.now()}`;
  const appPid = await app.evaluate(() => process.pid);
  let backend;
  if (process.platform === "win32") {
    const processTree = spawnSync(
      "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${appPid}' | Select-Object ProcessId,Name | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const children = JSON.parse(processTree.stdout || "[]");
    backend = (Array.isArray(children) ? children : [children]).find(
      (p) => p.Name === "python.exe",
    );
  } else {
    const table = spawnSync("/bin/ps", ["-eo", "pid=,ppid=,comm="], {
      encoding: "utf8",
    });
    if (table.status !== 0)
      throw new Error("Cannot inspect backend processes: " + table.stderr);
    backend = table.stdout
      .split("\n")
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        return match
          ? {
              ProcessId: Number(match[1]),
              ParentId: Number(match[2]),
              Name: match[3],
            }
          : null;
      })
      .find((row) => row?.ParentId === appPid && /python/i.test(row.Name));
  }
  if (!backend)
    throw new Error("Desktop did not start its owned Python service.");
  await page.getByRole("textbox", { name: "Chapter text editor" }).fill(text);
  // Close immediately, before the 500 ms autosave debounce can complete.
  const finished = app.waitForEvent("close", { timeout: 25_000 });
  await app.evaluate(({ BrowserWindow, app }) => {
    if (process.platform === "darwin") app.quit();
    else BrowserWindow.getAllWindows()[0].close();
  });
  await finished;
  closed = true;
  const check = spawnSync(
    path.join(resources, layout.python),
    [
      "-I",
      "-c",
      'import json,sqlite3,sys; db=sqlite3.connect(sys.argv[1]); row=db.execute("SELECT snapshot FROM projects WHERE id=?",(sys.argv[2],)).fetchone(); p=json.loads(row[0]); print(json.dumps({"revision":p["revision"],"texts":[c["text"] for c in p["book"]["chapters"]]}))',
      path.join(output, "alder.sqlite3"),
      projectId,
    ],
    { env, encoding: "utf8", windowsHide: true },
  );
  if (check.status !== 0) throw new Error(check.stderr);
  const saved = JSON.parse(check.stdout);
  if (!saved.texts.includes(text))
    throw new Error("The final edit was not preserved by close.");
  if (process.platform === "win32") {
    const remaining = spawnSync(
      "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$p = Get-Process -Id ${backend.ProcessId} -ErrorAction SilentlyContinue; if ($p) { exit 1 }; exit 0`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (remaining.status !== 0)
      throw new Error("The owned Python service survived desktop close.");
  } else {
    let alive = false;
    try {
      process.kill(backend.ProcessId, 0);
      alive = true;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    if (alive)
      throw new Error("The owned Python service survived desktop quit.");
  }
  const report = {
    status: "passed",
    packaged,
    resources,
    finalEditSaved: true,
    backendStopped: true,
    projectId,
    revision: saved.revision,
    features,
    nativeMenu,
  };
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (!closed) await app.close();
}
