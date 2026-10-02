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

/** Do something that changes the character and wait for the new picture to be on the canvas. */
async function redraw(page: Page, action: () => Promise<unknown>): Promise<void> {
  const before = await page.locator('#canvas').getAttribute('data-drawn');
  await action();
  await expect(page.locator('#canvas')).not.toHaveAttribute('data-drawn', before ?? '', { timeout: 30_000 });
  await expect(page.locator('#canvas.building')).toHaveCount(0);
}

/** Put an item in a slot by searching for its name, as a user would. */
async function equip(page: Page, slot: string, name: string): Promise<void> {
  const row = page.locator(`[data-slot="${slot}"]`);
  await row.locator('.slot-pick').click();
  await row.locator('input').fill(name);
  const result = row.locator('.results button').filter({ has: page.getByText(name, { exact: true }) }).first();
  await redraw(page, () => result.click());
  await expect(row.locator('.item-name')).toHaveText(name);
}

/** Problems the page lists for the character on screen. */
async function problemsShown(page: Page): Promise<string[]> {
  const problems = await page.locator('#character-problems li').allInnerTexts();
  if (await page.locator('#character-error').count()) problems.push(await page.locator('#character-error').innerText());
  return problems;
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

/** Step through every race and sex, saving a picture of each and collecting anything reported missing. */
async function everyRace(page: Page, folder: string): Promise<string[]> {
  const races = await page.locator('#race option').allInnerTexts();
  expect(races.length).toBeGreaterThanOrEqual(8);
  const missing: string[] = [];
  let first = true;
  for (const race of races) {
    for (const sex of ['Male', 'Female']) {
      const select = async () => {
        await page.locator('#race').selectOption({ label: race });
        await page.locator('#sex button', { hasText: new RegExp(`^${sex}$`) }).click();
      };
      // The first combination is already on screen.
      if (first) await select();
      else await redraw(page, select);
      first = false;
      const name = `${race} ${sex}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await page.locator('#canvas').screenshot({ path: `test-results/${folder}/${name}.png` });
      for (const problem of await problemsShown(page)) missing.push(`${race} ${sex}: ${problem}`);
    }
  }
  return missing;
}

test('draws every race and sex with nothing missing', async ({ page }) => {
  test.setTimeout(300_000);
  await load(page, false);
  await openAndDraw(page);
  expect(await everyRace(page, 'races')).toEqual([]);
});

const PLATE: [slot: string, name: string][] = [
  ['head', 'Dreadnaught Helmet'],
  ['shoulder', 'Dreadnaught Pauldrons'],
  ['back', 'Cloak of the Fallen God'],
  ['chest', 'Dreadnaught Breastplate'],
  ['wrist', 'Dreadnaught Bracers'],
  ['hands', 'Dreadnaught Gauntlets'],
  ['waist', 'Dreadnaught Waistguard'],
  ['legs', 'Dreadnaught Legplates'],
  ['feet', 'Dreadnaught Sabatons'],
  ['mainHand', 'Thunderfury, Blessed Blade of the Windseeker'],
  ['offHand', 'Blessed Qiraji Bulwark'],
];

const CLOTH: [slot: string, name: string][] = [
  ['head', 'Frostfire Circlet'],
  ['shoulder', 'Frostfire Shoulderpads'],
  ['chest', 'Frostfire Robe'],
  ['shirt', "Recruit's Shirt"],
  ['tabard', 'Tabard of Mastery'],
  ['wrist', 'Frostfire Bindings'],
  ['hands', 'Frostfire Gloves'],
  ['waist', 'Frostfire Belt'],
  ['legs', 'Frostfire Leggings'],
  ['feet', 'Frostfire Sandals'],
  ['mainHand', 'Atiesh, Greatstaff of the Guardian'],
];

const MAIL: [slot: string, name: string][] = [
  ['head', 'Cryptstalker Headpiece'],
  ['shoulder', 'Cryptstalker Spaulders'],
  ['back', 'Shifting Cloak'],
  ['chest', 'Cryptstalker Tunic'],
  ['wrist', 'Cryptstalker Wristguards'],
  ['hands', 'Cryptstalker Handguards'],
  ['waist', 'Cryptstalker Girdle'],
  ['legs', 'Cryptstalker Legguards'],
  ['feet', 'Cryptstalker Boots'],
  ['mainHand', "Rhok'delar, Longbow of the Ancient Keepers"],
];

for (const [outfit, items] of [['plate', PLATE], ['cloth', CLOTH], ['mail', MAIL]] as const) {
  test(`dresses every race and sex in ${outfit} with nothing missing`, async ({ page }) => {
    test.setTimeout(600_000);
    await load(page, false);
    await openAndDraw(page);
    for (const [slot, name] of items) await equip(page, slot, name);
    // Every slot shows the item's icon once it is equipped.
    await expect(page.locator('#gear .slot-pick canvas.icon')).toHaveCount(items.length);
    await page.screenshot({ path: `test-results/page-${outfit}.png`, fullPage: true });
    expect(await everyRace(page, outfit)).toEqual([]);
  });
}

test('removes an item', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  const before = await page.locator('#canvas').screenshot();
  await equip(page, 'chest', 'Frostfire Robe');
  expect((await page.locator('#canvas').screenshot()).equals(before)).toBe(false);
  await redraw(page, () => page.locator('[data-slot="chest"] .slot-clear').click());
  await expect(page.locator('[data-slot="chest"] .item-name')).toHaveText('Empty');
  expect((await page.locator('#canvas').screenshot()).equals(before)).toBe(true);
});

test('changes the picture when an appearance choice changes', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  const before = await page.locator('#canvas').screenshot();
  const hair = page.locator('select[data-option="Hair Style"]');
  await redraw(page, () => hair.selectOption({ index: 3 }));
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

test('exports a glowing weapon with its glow as transparency', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  await equip(page, 'mainHand', 'Thunderfury, Blessed Blade of the Windseeker');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  await download.saveAs('test-results/export-glow.png');
  const image = decodePng(readFileSync('test-results/export-glow.png'));

  // The glow is additive light: partly transparent pixels that are bright for their coverage.
  let glow = 0;
  for (let i = 0; i < image.pixels.length; i += 4) {
    const alpha = image.pixels[i + 3]!;
    if (alpha > 10 && alpha < 200 && image.pixels[i + 2]! > 200) glow++;
  }
  console.log('glow pixels', glow);
  expect(glow).toBeGreaterThan(1000);

  // Kept for looking at by eye: the picture, quarter size, over black, white and magenta.
  const small = { width: image.width >> 2, height: image.height >> 2, pixels: new Uint8Array((image.width >> 2) * (image.height >> 2) * 4) };
  for (let y = 0; y < small.height; y++) {
    for (let x = 0; x < small.width; x++) {
      small.pixels.set(image.pixels.subarray((y * 4 * image.width + x * 4) * 4, (y * 4 * image.width + x * 4) * 4 + 4), (y * small.width + x) * 4);
    }
  }
  writePng('test-results/export-glow-black.png', over(small, [0, 0, 0]));
  writePng('test-results/export-glow-white.png', over(small, [255, 255, 255]));
  writePng('test-results/export-glow-magenta.png', over(small, [255, 0, 255]));
});
