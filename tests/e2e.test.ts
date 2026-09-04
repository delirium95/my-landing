import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import JSZip from 'jszip';
import { chromium, type Browser } from 'playwright-core';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const baseUrl = 'http://127.0.0.1:4174';

let preview: ChildProcess;
let browser: Browser;

async function waitForPreview(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error('Vite preview did not start');
}

before(async () => {
  preview = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', '4174'], {
    cwd: projectRoot,
    stdio: 'ignore',
  });
  await waitForPreview();
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
});

after(async () => {
  await browser?.close();
  preview?.kill('SIGTERM');
});

test('a stranger can finish the demo loop and receive a valid ZIP', async () => {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  await page.locator('[data-demo-trigger]').first().click();
  await page.locator('[data-review-state]').waitFor({ state: 'visible' });

  assert.equal(await page.locator('[data-ready-count]').textContent(), '3 files');
  assert.equal(await page.locator('[data-score]').textContent(), '100');
  assert.equal(await page.locator('[data-fix-count]').textContent(), '3');
  assert.equal(await page.locator('[data-duplicate-count]').textContent(), '1');
  assert.equal(await page.locator('.file-row').count(), 4);
  assert.equal(await page.locator('.file-row.is-excluded').count(), 1);

  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-download]').click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /^sendset-\d{4}-\d{2}-\d{2}\.zip$/u);

  const archivePath = await download.path();
  assert.ok(archivePath);
  const zip = await JSZip.loadAsync(await readFile(archivePath));
  const names = Object.keys(zip.files);
  assert.deepEqual(names.sort(), [
    'Logo New.png',
    'Notes For Client.docx',
    'Q3 Strategy Final V4.pdf',
    'sendset-manifest.txt',
  ]);
  const manifest = await zip.file('sendset-manifest.txt')?.async('string');
  assert.match(manifest || '', /Exact copies skipped: 1/u);
  assert.match(manifest || '', /Q3_strategy_FINAL_final_v4 \(2\)\.pdf → Q3 Strategy Final V4\.pdf/u);

  await context.close();
});

test('the primary experience does not overflow a 390px viewport', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
    hero: document.querySelector<HTMLElement>('.hero-copy')?.scrollWidth ?? 0,
  }));

  assert.equal(dimensions.viewport, 390);
  assert.ok(dimensions.page <= dimensions.viewport, `page width ${dimensions.page}px exceeds ${dimensions.viewport}px`);
  assert.ok(dimensions.hero <= 360, `hero width ${dimensions.hero}px exceeds its mobile column`);

  await context.close();
});
