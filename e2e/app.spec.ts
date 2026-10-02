import { expect, type Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { hasClient, WOW_DIR } from '../test/node-source';
import { writePng } from '../test/png';
import { decodePng, over } from '../test/png-decode';

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

/** Give the page the game folder and wait for the first character to be drawn. */
async function openAndDraw(page: Page): Promise<void> {
  await page.locator('#folder').setInputFiles(WOW_DIR);
  await expect(page.locator('#character-note')).toContainText('Built in', { timeout: 60_000 });
}

/** A real file drag from the OS, injected through the DevTools protocol. */
async function dropFolder(page: Page, path: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [path], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await cdp.send('Input.dispatchDragEvent', { type, x: 400, y: 300, data });
  }
}

async function expectFolderRead(page: Page): Promise<void> {
  await expect(page.locator('#build')).toContainText(/\d+\.\d+\.\d+\.\d+/, { timeout: 60_000 });
  const files = await page.locator('#files').innerText();
  const [onDisk, listed] = files.match(/[\d,]+/g)!.map((n) => Number(n.replaceAll(',', '')));
  expect(listed).toBeGreaterThan(500_000);
  expect(onDisk! / listed!).toBeGreaterThan(0.99);
}

test('reads a chosen folder with the network off, and says why it cannot draw', async ({ page }) => {
  const requests = await load(page, true);
  await page.locator('#folder').setInputFiles(WOW_DIR);
  await expectFolderRead(page);
  // The game files are read without the network; the database needs the table definitions.
  await expect(page.locator('#character-error')).toContainText('could not be drawn');
  // The only thing asked of the network after the folder was given is the definitions.
  expect(requests.filter((url) => !url.startsWith(DEFINITIONS))).toEqual([]);
});

test('reads a dropped folder', async ({ page }) => {
  await load(page, true);
  await dropFolder(page, WOW_DIR);
  await expectFolderRead(page);
});

test('explains a dropped folder that is not a WoW folder', async ({ page }) => {
  await load(page, true);
  await dropFolder(page, `${WOW_DIR}/Data`);
  await expect(page.locator('#status')).toContainText('You picked the Data folder');
});

test('draws a human male first, with nothing missing', async ({ page }) => {
  const requests = await load(page, false);
  await openAndDraw(page);
  await expect(page.locator('#race option:checked')).toHaveText('Human');
  await expect(page.locator('#sex .on')).toHaveText('Male');
  await expect(page.locator('#character-problems')).toHaveCount(0);
  expect(requests.some((url) => url.startsWith(DEFINITIONS))).toBe(true);
  expect(requests.filter((url) => !url.startsWith(DEFINITIONS))).toEqual([]);
  // Kept for looking at by eye; test-results/ is not committed.
  await page.screenshot({ path: 'test-results/page.png', fullPage: true });
});

test('draws every race and sex with nothing missing', async ({ page }) => {
  test.setTimeout(300_000);
  await load(page, false);
  await openAndDraw(page);
  const races = await page.locator('#race option').allInnerTexts();
  expect(races.length).toBeGreaterThanOrEqual(8);
  const missing: string[] = [];
  for (const race of races) {
    await page.locator('#race').selectOption({ label: race });
    for (const sex of await page.locator('#sex button').allInnerTexts()) {
      await page.locator('#sex button', { hasText: new RegExp(`^${sex}$`) }).click();
      // Wait for this character, not the previous one, to be on the canvas.
      await expect(page.locator('#canvas.building')).toHaveCount(0);
      await expect(page.locator('#sex .on')).toHaveText(sex);
      await page.waitForTimeout(150);
      await expect(page.locator('#canvas.building')).toHaveCount(0);
      const name = `${race} ${sex}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await page.locator('#canvas').screenshot({ path: `test-results/races/${name}.png` });
      const problems = await page.locator('#character-problems li').allInnerTexts();
      if (problems.length > 0) missing.push(`${race} ${sex}: ${problems.join('; ')}`);
      if (await page.locator('#character-error').count()) missing.push(`${race} ${sex}: ${await page.locator('#character-error').innerText()}`);
    }
  }
  expect(missing).toEqual([]);
});

test('changes the picture when an appearance choice changes', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  const before = await page.locator('#canvas').screenshot();
  const hair = page.locator('select[data-option="Hair Style"]');
  await hair.selectOption({ index: 3 });
  await expect(page.locator('#canvas.building')).toHaveCount(0);
  await page.waitForTimeout(300);
  const after = await page.locator('#canvas').screenshot({ path: 'test-results/human-male-hair.png' });
  expect(after.equals(before)).toBe(false);
  await expect(page.locator('#character-problems')).toHaveCount(0);
  // The other options keep their choices.
  await expect(hair.locator('option:checked')).not.toHaveText('Bald');
});

test('exports a clean transparent PNG', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);

  const save = async (name: string) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
    expect(download.suggestedFilename()).toBe('mogshot-human-male.png');
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
  const crop = { width: head.width, height: head.height, pixels: new Uint8Array(head.width * head.height * 4) };
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
