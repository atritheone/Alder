// Developer-only, generated PCM: compare display cost, never speech quality.
import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { desktopExecutable } from "../desktop-paths.mjs";
const directory =
  process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "alder-waveform-"));
fs.mkdirSync(directory, { recursive: true });
const old = spawnSync(
  "git",
  ["show", "7226aea:frontend/src/NarrationReview.tsx"],
  { maxBuffer: 1024 * 1024 },
);
if (old.status) throw Error("Cannot read waveform baseline.");
const baseline = path.join(directory, "NarrationReview.tsx");
fs.writeFileSync(baseline, old.stdout);
if (!fs.existsSync(path.join(directory, "node_modules")))
  fs.symlinkSync(
    path.resolve("node_modules"),
    path.join(directory, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
const fixture = `
import {createRoot} from 'react-dom/client';import {createElement} from 'react';
import Review from 'REVIEW_SOURCE';
const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;z-index:99999;background:white;overflow:auto';document.body.append(host);
const chunks=Array.from({length:10},(_,i)=>({id:'chunk-'+i,text:'Synthetic PCM fixture',status:'ready',audioUrl:'/__waveform__/chunk/'+i,seconds:60,startSeconds:i*60,playbackEligible:true,qa:{status:'matched',audioHash:i.toString(16).padStart(64,'a')}}));
window.__waveRequests={complete:0,chunk:0};const original=fetch;
function pcm(seconds){const frames=seconds*24000,buffer=new ArrayBuffer(44+frames*2),v=new DataView(buffer);const tag=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));tag(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,frames*2,true);new Int16Array(buffer,44).fill(16384);return buffer;}
window.fetch=async(input,options)=>{const url=new URL(String(input),location.href);if(url.pathname.startsWith('/__waveform__/')){options?.signal?.throwIfAborted();const complete=url.pathname.endsWith('/complete');window.__waveRequests[complete?'complete':'chunk']++;return new Response(pcm(complete?600:60));}return original(input,options);};
window.__waveTasks=[];new PerformanceObserver(list=>window.__waveTasks.push(...list.getEntries().filter(e=>e.startTime>=window.__waveStart).map(e=>e.duration))).observe({type:'longtask'});
createRoot(host).render(createElement(Review,{job:{id:'generated-waveform',status:'ready',reviewStatus:'needs_review',strictVerification:true,audioUrl:'/__waveform__/complete',seconds:600,chunks},onPlayChunk:()=>{},onSeek:()=>{}}));`;
const report = {
  scope:
    "Synthetic ten-minute PCM display; sampled renderer working set, not a speech-quality or acoustic test.",
  measurements: [],
};
for (const label of ["baseline", "candidate"]) {
  let app;
  try {
    const input =
      label === "baseline"
        ? baseline
        : path.resolve("frontend/src/NarrationReview.tsx");
    const compiled = await build({
      stdin: {
        contents: fixture.replace("REVIEW_SOURCE", input.replaceAll("\\", "/")),
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      outfile: path.join(directory, `${label}.js`),
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      plugins:
        label === "baseline"
          ? [
              {
                name: "baseline-relative-imports",
                setup(builder) {
                  builder.onResolve({ filter: /^\.\// }, (args) => {
                    if (args.importer !== baseline) return;
                    const base = path.resolve("frontend/src", args.path);
                    const file = [base, base + ".ts", base + ".tsx"].find(
                      fs.existsSync,
                    );
                    return file ? { path: file } : undefined;
                  });
                },
              },
            ]
          : [],
    });
    const profile = path.join(directory, label);
    app = await electron.launch({
      executablePath: desktopExecutable(),
      args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
      env: { ...process.env, ALDER_DATA_DIR: profile + "/data" },
    });
    const page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "New", exact: true }),
    ).toBeVisible();
    await page.evaluate(
      compiled.outputFiles.find((file) => file.path.endsWith(".js")).text,
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    const before = await cdp.send("Runtime.getHeapUsage");
    let peakKiB = 0;
    const sample = async () => {
      const n = await app.evaluate(({ app }) =>
        app
          .getAppMetrics()
          .filter((p) => p.type === "Tab")
          .reduce((sum, p) => sum + p.memory.workingSetSize, 0),
      );
      peakKiB = Math.max(peakKiB, n);
    };
    await sample();
    const initialKiB = peakKiB;
    await page.evaluate(() => {
      window.__waveTasks = [];
      window.__waveStart = performance.now();
    });
    const start = performance.now();
    await page
      .getByRole("button", { name: "Show waveform", exact: true })
      .click();
    while (
      !(await page
        .locator("canvas.narration-waveform-canvas, .narration-waveform canvas")
        .count())
    ) {
      await sample();
      if (performance.now() - start > 60000)
        throw Error(
          "Waveform did not finish: " +
            (await page.locator("body").innerText()),
        );
      await page.waitForTimeout(10);
    }
    await sample();
    const end = await cdp.send("Runtime.getHeapUsage");
    const observed = await page.evaluate(() => ({
      requests: window.__waveRequests,
      longTasks: window.__waveTasks,
    }));
    expect(observed.requests.complete).toBe(label === "baseline" ? 1 : 0);
    expect(observed.requests.chunk).toBe(label === "baseline" ? 0 : 10);
    report.measurements.push({
      label,
      ms: performance.now() - start,
      initialRendererKiB: initialKiB,
      peakRendererKiB: peakKiB,
      peakIncreaseKiB: peakKiB - initialKiB,
      before,
      end,
      ...observed,
    });
  } finally {
    await app?.close();
  }
}
report.status = "passed";
fs.writeFileSync(
  path.join(directory, "waveform.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
