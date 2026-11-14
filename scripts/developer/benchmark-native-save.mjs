// Normal desktop Save against synthetic native TXT files, including byte guards.
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { desktopExecutable } from "../desktop-paths.mjs";
import { createHash } from "node:crypto";
const directory = path.resolve(
  process.argv[2] ||
    fs.mkdtempSync(path.join(os.tmpdir(), "alder-native-save-")),
);
fs.mkdirSync(directory, { recursive: true });
const resources = path.resolve(
  process.env.ALDER_RESOURCES_DIR || "work/bundle-resources",
);
const layout = JSON.parse(
  fs.readFileSync("backend/alder/runtime-layout.json", "utf8"),
)[process.platform];
const generated = spawnSync(
  path.join(resources, layout.python),
  [
    "-B",
    "scripts/developer/opening-fixtures.py",
    path.join(directory, "fixtures"),
  ],
  { encoding: "utf8", windowsHide: true },
);
if (generated.status) throw Error(generated.stderr);
const report = {
  status: "running",
  platform: process.platform,
  measurements: [],
};
let app;
try {
  for (const name of [
    "Small UTF8.txt",
    "Large 1MiB.txt",
    "Unicode UTF16.txt",
  ]) {
    const file = path.join(directory, "fixtures", name),
      profile = fs.mkdtempSync(path.join(directory, "profile-"));
    const original = fs.readFileSync(file),
      utf16 = name.includes("UTF16"),
      decode = (raw) =>
        raw
          .toString(utf16 ? "utf16le" : "utf8")
          .replace(/^\uFEFF/, "")
          .replaceAll("\r\n", "\n"),
      text = decode(original);
    app = await electron.launch({
      executablePath: desktopExecutable(),
      args: [".", "--headless-test", `--user-data-dir=${profile}/profile`],
      env: { ...process.env, ALDER_DATA_DIR: profile + "/data" },
    });
    await app.evaluate(() => {
      globalThis.nativeSaveTraffic = [];
      const original = globalThis.fetch;
      globalThis.fetch = async (...args) => {
        const start = performance.now();
        const response = await original(...args);
        globalThis.nativeSaveTraffic.push({
          path: new URL(String(args[0])).pathname,
          ms: performance.now() - start,
        });
        return response;
      };
    });
    const page = await app.firstWindow();
    await page.locator(".start-screen input[type=file]").setInputFiles(file);
    const bindings = await app.evaluate(
      ({ app }) => `${app.getPath("userData")}/document-files.json`,
    );
    const editor = page.locator(".cm-content[contenteditable=true]");
    await expect(editor).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".save-status")).toHaveText("Saved", {
      timeout: 30000,
    });
    await page.waitForTimeout(3000);
    await editor.focus();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home",
    );
    const timings = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.type("x");
      const start = performance.now();
      await page.keyboard.press("ControlOrMeta+s");
      // Exercise App's final-character flush before the native write, just like Save.
      await expect
        .poll(() => decode(fs.readFileSync(file)), {
          timeout: 30000,
          intervals: [10],
        })
        .toBe("x".repeat(i + 1) + text);
      const raw = fs.readFileSync(file);
      const digest = createHash("sha256").update(raw).digest("hex");
      await expect
        .poll(
          () =>
            Object.values(JSON.parse(fs.readFileSync(bindings, "utf8"))).some(
              (binding) => binding.path === file && binding.digest === digest,
            ),
          { intervals: [10] },
        )
        .toBe(true);
      timings.push(performance.now() - start);
      // Keep the byte oracle outside the measured Save interval.
      expect(decode(raw)).toBe("x".repeat(i + 1) + text);
      if (utf16)
        expect([...raw.subarray(0, 2)]).toEqual([...original.subarray(0, 2)]);
      if (!utf16 && original.includes(Buffer.from("\r\n")))
        expect(raw.toString("utf8").includes("\r\n")).toBe(true);
      const bom = utf16 ? 2 : 0;
      expect(
        raw.equals(
          Buffer.concat([
            original.subarray(0, bom),
            Buffer.from("x".repeat(i + 1), utf16 ? "utf16le" : "utf8"),
            original.subarray(bom),
          ]),
        ),
      ).toBe(true);
    }
    const saved = fs.readFileSync(file);
    fs.appendFileSync(
      file,
      Buffer.from(
        utf16
          ? "external change".split("").flatMap((c) => [c.charCodeAt(0), 0])
          : "external change",
      ),
    );
    const external = fs.readFileSync(file);
    const refused = await page.evaluate(async () => {
      try {
        await window.alder.saveDocument(
          localStorage.getItem("alder.project"),
          "txt",
          "Synthetic native save",
          "save",
        );
        return false;
      } catch {
        return true;
      }
    });
    expect(refused).toBe(true);
    expect(fs.readFileSync(file)).toEqual(external);
    fs.writeFileSync(file, saved);
    const traffic = await app.evaluate(() => globalThis.nativeSaveTraffic);
    report.measurements.push({
      name,
      saveMs: timings,
      traffic,
      externalChangePreserved: true,
      exactBytes: true,
    });
    await app.close();
    app = null;
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  await app?.close();
  fs.writeFileSync(
    path.join(directory, "native-save.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
}
