// Native cancellation and preview ownership; synthetic data, normal shutdown.
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { desktopExecutable } from "../desktop-paths.mjs";
const profile = fs.mkdtempSync(
  path.join(os.tmpdir(), "alder-operation-lifecycle-"),
);
const env = { ...process.env, ALDER_DATA_DIR: path.join(profile, "data") };
for (const key of ["PYTHONHOME", "PYTHONPATH", "ELECTRON_RUN_AS_NODE"])
  delete env[key];
let app;
try {
  app = await electron.launch({
    executablePath: desktopExecutable(),
    args: [".", "--headless-test", `--user-data-dir=${profile}/chromium`],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  console.log("Checking disposable preview lifecycle");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("button", { name: "Word Document", exact: false })
    .click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "Chapter text editor",
    exact: true,
  });
  await editor.fill("A cancelled preview preserves this synthetic document.");
  await expect(page.locator(".save-status")).toHaveText("Saved", {
    timeout: 30000,
  });
  console.log("Saved synthetic source");
  await app.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.operationProbe = { hold: true, started: 0, aborted: 0 };
    globalThis.fetch = async (...args) => {
      if (
        String(args[0]).endsWith("/publication-layout") &&
        globalThis.operationProbe.hold
      ) {
        globalThis.operationProbe.started++;
        await new Promise((resolve, reject) => {
          const signal = args[1].signal;
          if (!signal)
            return reject(Error("Missing desktop cancellation signal."));
          const abort = () => {
            globalThis.operationProbe.aborted++;
            reject(signal.reason);
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      }
      return original(...args);
    };
  });
  const preview = page.getByRole("button", { name: "Preview", exact: true });
  await preview.click();
  await expect
    .poll(() => app.evaluate(() => globalThis.operationProbe.started))
    .toBe(1);
  console.log("Held PDF preparation");
  const started = performance.now();
  await page
    .getByRole("button", { name: "Back To Write", exact: true })
    .click();
  await expect
    .poll(() => app.evaluate(() => globalThis.operationProbe.aborted))
    .toBe(1);
  console.log("Cancelled PDF preparation");
  const cancelMs = performance.now() - started;
  await expect(editor).toBeVisible();
  await app.evaluate(() => {
    globalThis.operationProbe.hold = false;
  });
  let readingRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/projects\/[^/]+\/preview(?:\?|$)/.test(request.url()))
      readingRequests++;
  });
  await preview.click();
  await expect(page.locator(".publication-page-text p")).toContainText(
    "A cancelled preview",
    { timeout: 60000 },
  );
  expect(readingRequests).toBe(0);
  const reading = page.getByRole("button", {
    name: "Reflowable reading",
    exact: true,
  });
  await reading.click();
  await expect(
    page
      .frameLocator('iframe[title="Reflowable publication preview"]')
      .locator("body"),
  ).toContainText("A cancelled preview");
  expect(readingRequests).toBe(1);
  await page.getByRole("button", { name: "Print PDF", exact: true }).click();
  await reading.click();
  await expect(
    page
      .frameLocator('iframe[title="Reflowable publication preview"]')
      .locator("body"),
  ).toContainText("A cancelled preview");
  expect(readingRequests).toBe(1);
  await page
    .getByRole("button", { name: "Back To Write", exact: true })
    .click();
  await expect(editor).toContainText("A cancelled preview");
  await app.evaluate(({app})=>{
    globalThis.publicationWindows=0;
    app.on('browser-window-created',()=>globalThis.publicationWindows++);
  });
  const repeated=await page.evaluate(async()=>{
    const id=localStorage.getItem('alder.project');const timings=[];const digests=[];
    for(let i=0;i<2;i++){
      const started=performance.now();const result=await window.alder.request('POST',`/api/projects/${id}/export`,{format:'pdf',options:{includeTitle:true}});
      const response=await fetch(window.alder.mediaBase+result.downloadUrl);
      const bytes=await response.arrayBuffer();
      if(!response.ok||bytes.byteLength<100)throw Error('Repeated PDF did not produce a publication.');
      digests.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).join(','));timings.push(performance.now()-started);
    }
    return {timings,equal:digests[0]===digests[1]};
  });
  expect(repeated.equal).toBe(true);
  expect(await app.evaluate(()=>globalThis.publicationWindows)).toBe(1);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      status: "passed",
      platform: process.platform,
      cancelMs,
      readingRequests,
      repeatedPreviewMs:repeated.timings,
      checks: [
        "pending PDF request transport aborted",
        "preview queue recovered and rendered real PDF",
        "HTML prepared on demand once",
        "source preserved",
        "unchanged PDF reused with identical bytes and one detached renderer",
      ],
    }),
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  const timeout = setTimeout(() => {
    void app?.evaluate(({ app }) => app.exit(1)).catch(() => {});
  }, 10000);
  try {
    await app?.close();
  } finally {
    clearTimeout(timeout);
  }
}
