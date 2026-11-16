import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { requireIsolatedTestPaths } from "../../electron/testIsolation";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "alder-isolation-unit-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const profile = path.join(root, "fixture", "profile"),
  data = path.join(root, "fixture", "data");
const normal = path.join(root, "normal");
fs.mkdirSync(normal);
it("requires separate explicit fixture paths before contacting another instance", () => {
  expect(() => requireIsolatedTestPaths([], data, [normal])).toThrow(
    "explicit absolute",
  );
  expect(() =>
    requireIsolatedTestPaths([`--user-data-dir=${profile}`], undefined, [
      normal,
    ]),
  ).toThrow("explicit absolute");
  expect(() =>
    requireIsolatedTestPaths([`--user-data-dir=${profile}`], profile, [normal]),
  ).toThrow("separate fixture");
  expect(() =>
    requireIsolatedTestPaths(
      [`--user-data-dir=${profile}`],
      path.join(profile, "data"),
      [normal],
    ),
  ).toThrow("separate fixture");
  expect(() =>
    requireIsolatedTestPaths(["--user-data-dir", profile], data, [normal]),
  ).not.toThrow();
});
it("rejects normal profiles, their children and aliases through filesystem links", () => {
  expect(() =>
    requireIsolatedTestPaths([`--user-data-dir=${normal}`], data, [normal]),
  ).toThrow("separate fixture");
  expect(() =>
    requireIsolatedTestPaths(
      [`--user-data-dir=${profile}`],
      path.join(normal, "projects"),
      [normal],
    ),
  ).toThrow("separate fixture");
  const alias = path.join(root, "alias");
  fs.symlinkSync(
    normal,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() =>
    requireIsolatedTestPaths(
      [`--user-data-dir=${path.join(alias, "profile")}`],
      data,
      [normal],
    ),
  ).toThrow("separate fixture");
});
