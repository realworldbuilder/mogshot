import { expect, type Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decodePng, over } from '../test/png-decode';
import { writePng } from '../test/png';
import { hasClient, WOW_DIR } from '../test/node-source';

// Needs a game install. Reported as skipped, not passed, when there is none.
test.skip(!hasClient, 'no game install at WOW_DIR');

const DEFINITIONS = 'https://raw.githubusercontent.com/wowdev/WoWDBDefs/';

/** Load the page, optionally cut the network, and record any request made after that. */
async function load(page: Page, offline: boolean): Promise<string[]> {
  const requests: string[] = [];
  await page.goto('./', { waitUntil: 'networkidle' });
  await page.context().setOffline(offline);
  // Worker requests are reported on the context, not the page.
  page.context().on('request', (request) => requests.push(request.url()));
  return requests;
}

async function expectInstallRead(page: Page, requests: string[], screenshot: string): Promise<void> {
  await expect(page.locator('#folder-status')).toHaveText('Your game files can be read', { timeout: 60_000 });

  await expect(page.locator('#build')).toContainText(/\d+\.\d+\.\d+\.\d+/);
  const files = await page.locator('#files').innerText();
  const [onDisk, listed] = files.match(/[\d,]+/g)!.map((n) => Number(n.replaceAll(',', '')));
  expect(listed).toBeGreaterThan(500_000);
  expect(onDisk! / listed!).toBeGreaterThan(0.99);

  const rows = page.locator('#result dd');
  await expect(rows.filter({ hasText: 'database table (WDC' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'model (MD21)' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'texture (BLP2)' })).toHaveCount(1);

  // The only thing asked of the network after the folder was given is the table definitions.
  expect(requests.filter((url) => !url.startsWith(DEFINITIONS))).toEqual([]);

  // Kept for looking at the page by eye; test-results/ is not committed.
  await page.screenshot({ path: `test-results/${screenshot}.png`, fullPage: true });
  console.log((await page.locator('#result').innerText()).replace(/\n+/g, '\n'));
}

test('reads a folder chosen with the button, network off', async ({ page }) => {
  const requests = await load(page, true);
  await page.locator('#folder').setInputFiles(WOW_DIR);
  await expectInstallRead(page, requests, 'chosen');
  // The game files are read without the network; only the database needs the definitions.
  await expect(page.locator('#tables')).toContainText('could not be downloaded');
});

test('reads the game database with definitions from GitHub', async ({ page }) => {
  const requests = await load(page, false);
  await page.locator('#folder').setInputFiles(WOW_DIR);
  await expectInstallRead(page, requests, 'online');
  await expect(page.locator('#tables')).toContainText(/Read \d+ races and [\d,]+ items/);
  expect(requests.some((url) => url.startsWith(DEFINITIONS))).toBe(true);
});

test('draws the human male', async ({ page }) => {
  await load(page, false);
  await page.locator('#folder').setInputFiles(WOW_DIR);
  await expect(page.locator('#character')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#character-note')).toContainText('Built in');
  // Kept for looking at by eye; test-results/ is not committed.
  await page.locator('#canvas').screenshot({ path: 'test-results/human-male.png' });
  // The only thing reported as not right is the one known gap.
  const problems = await page.locator('#character-problems li').allInnerTexts();
  expect(problems.filter((p) => !p.startsWith('Face shape: bone sets'))).toEqual([]);
});

test('exports a clean transparent PNG', async ({ page }) => {
  await load(page, false);
  await page.locator('#folder').setInputFiles(WOW_DIR);
  await expect(page.locator('#character')).toBeVisible({ timeout: 60_000 });

  const save = async (name: string) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
    const path = `test-results/${name}.png`;
    await download.saveAs(path);
    await expect(page.locator('#export-note')).toContainText('Saved');
    console.log(name, await page.locator('#export-note').innerText());
    return decodePng(readFileSync(path));
  };

  // Cropped: the longer side is 3840 and the character reaches every edge but for a sliver.
  const cropped = await save('export-tight');
  expect(Math.max(cropped.width, cropped.height)).toBe(3840);
  const alphaAt = (image: typeof cropped, x: number, y: number) => image.pixels[(y * image.width + x) * 4 + 3]!;
  for (const [x, y] of [[0, 0], [cropped.width - 1, 0], [0, cropped.height - 1], [cropped.width - 1, cropped.height - 1]]) {
    expect(alphaAt(cropped, x!, y!)).toBe(0);
  }
  let top = cropped.height;
  let bottom = 0;
  for (let y = 0; y < cropped.height; y += 4) {
    for (let x = 0; x < cropped.width; x += 4) {
      if (alphaAt(cropped, x, y) === 0) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  expect(top).toBeLessThan(cropped.height * 0.02);
  expect(bottom).toBeGreaterThan(cropped.height * 0.98);

  // Straight alpha: partly transparent edge pixels keep the colour of what they belong to.
  // With a dark fringe they would be much darker than the solid pixels beside them.
  let edge = 0;
  let solid = 0;
  let pairs = 0;
  const { width, height, pixels } = cropped;
  for (let y = 1; y < height - 1; y += 3) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const neighbour = i + 4;
      if (pixels[i + 3]! > 40 && pixels[i + 3]! < 215 && pixels[neighbour + 3] === 255) {
        edge += pixels[i]! + pixels[i + 1]! + pixels[i + 2]!;
        solid += pixels[neighbour]! + pixels[neighbour + 1]! + pixels[neighbour + 2]!;
        pairs++;
      }
    }
  }
  console.log('edge pixels checked', pairs, 'edge/solid brightness', (edge / solid).toFixed(3));
  expect(pairs).toBeGreaterThan(500);
  expect(edge / solid).toBeGreaterThan(0.9);
  expect(edge / solid).toBeLessThan(1.1);

  // Kept for looking at by eye: the head over black, white and magenta.
  const head = { x: Math.round(width * 0.3), y: 0, width: Math.round(width * 0.4), height: Math.round(height * 0.14) };
  const crop = {
    width: head.width,
    height: head.height,
    pixels: new Uint8Array(head.width * head.height * 4),
  };
  for (let y = 0; y < head.height; y++) {
    crop.pixels.set(pixels.subarray(((head.y + y) * width + head.x) * 4, ((head.y + y) * width + head.x + head.width) * 4), y * head.width * 4);
  }
  writePng('test-results/export-head-black.png', over(crop, [0, 0, 0]));
  writePng('test-results/export-head-white.png', over(crop, [255, 255, 255]));
  writePng('test-results/export-head-magenta.png', over(crop, [255, 0, 255]));

  // Uncropped: the canvas's shape, 3840 tall.
  await page.locator('#tight').uncheck();
  const full = await save('export-full');
  expect(full.height).toBe(3840);
  expect(full.width).toBe(2880);
});

test('reads a folder dropped on the page, network off', async ({ page }) => {
  const requests = await load(page, true);
  // A real file drag from the OS, injected through the DevTools protocol.
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [WOW_DIR], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await cdp.send('Input.dispatchDragEvent', { type, x: 400, y: 300, data });
  }
  await expectInstallRead(page, requests, 'dropped');
});

test('explains a dropped folder that is not a WoW folder', async ({ page }) => {
  await load(page, true);
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [`${WOW_DIR}/Data`], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await cdp.send('Input.dispatchDragEvent', { type, x: 400, y: 300, data });
  }
  await expect(page.locator('#status')).toContainText('You picked the Data folder');
});
