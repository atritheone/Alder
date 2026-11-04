import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import { desktopExecutable } from './desktop-paths.mjs';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const directory = path.resolve('work/hyphenation-presentation'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'alder-hyphen-presentation-'));
fs.mkdirSync(directory, { recursive: true });
const report = { status: 'running', cases: [], errors: [] }; let app;
try {
  await build({ entryPoints: ['scripts/hyphenation-presentation-probe.ts'], bundle: true, outfile: path.join(directory, 'probe.js'), platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
  app = await electron.launch({ executablePath: desktopExecutable(), args: ['.', '--headless-test', `--user-data-dir=${profile}/profile`], env: { ...process.env, ALDER_DATA_DIR: `${profile}/data` } });
  const page = await app.firstWindow(); page.on('pageerror', e => report.errors.push(e.message));
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
  await page.evaluate(fs.readFileSync(path.join(directory, 'probe.js'), 'utf8'));
  for (const font of ['Cambria', 'Arial', 'Times New Roman']) for (const align of ['left', 'justify']) for (const width of [297, 419]) {
    const result = await page.evaluate(args => window.__hyphenPresentation(args), { font, width, align });
    report.cases.push({ font, width, align, ...result });
    expect(result.total).toBeGreaterThan(result.retained); expect(result.retained).toBeGreaterThan(0);
    expect(result.unchanged).toBe(true); expect(result.editUnchanged).toBe(true); expect(result.resizedUnchanged).toBe(true);
  }
  expect(report.errors).toEqual([]); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
finally { fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); await app?.close(); }
