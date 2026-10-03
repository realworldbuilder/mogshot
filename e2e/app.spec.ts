import { expect, type Page, test } from '@playwright/test';
import { globSync, readFileSync } from 'node:fs';
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

  // Fixed sizes come out at exactly that size.
  for (const [id, width, height] of [['4k', 3840, 2160], ['1080p', 1920, 1080], ['youtube', 1280, 720], ['square', 2160, 2160]] as const) {
    await page.locator('#size').selectOption(id);
    const fixed = await save(`export-${id}`);
    expect([fixed.width, fixed.height]).toEqual([width, height]);
    // The character is in the picture and the corners are clear.
    expect(alphaAt(fixed, 0, 0)).toBe(0);
    expect(alphaAt(fixed, width >> 1, height >> 1)).toBe(255);
  }
});

/** Do something that changes the pose and wait for the new pose to be on the canvas. */
async function repose(page: Page, action: () => Promise<unknown>): Promise<void> {
  const before = await page.locator('#canvas').getAttribute('data-pose');
  await action();
  await expect(page.locator('#canvas')).not.toHaveAttribute('data-pose', before ?? '', { timeout: 30_000 });
}

test('strikes every curated pose, dressed and armed', async ({ page }) => {
  test.setTimeout(300_000);
  await load(page, false);
  await openAndDraw(page);
  for (const [slot, name] of PLATE) await equip(page, slot, name);
  for (const [race, sex] of [['Human', 'Male'], ['Tauren', 'Female'], ['Gnome', 'Male']]) {
    await redraw(page, async () => {
      await page.locator('#race').selectOption({ label: race! });
      if ((await page.locator('#sex .on').innerText()) !== sex) await page.locator('#sex button', { hasText: new RegExp(`^${sex}$`) }).click();
    }).catch(() => undefined); // the first combination may already be on screen
    const names = await page.locator('#presets button').allInnerTexts();
    expect(names).toEqual(['Stand', 'Ready', 'Attack', 'Cast', 'Roar', 'Cheer', 'Point', 'Flex', 'Salute', 'Wave', 'Kneel']);
    const pictures = new Set<string>();
    for (const name of names) {
      const button = page.locator('#presets button', { hasText: new RegExp(`^${name}$`) });
      if (name !== 'Stand') await repose(page, () => button.click());
      else await button.click();
      await expect(button).toHaveClass(/on/);
      const file = `${race} ${sex} ${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const shot = await page.locator('#canvas').screenshot({ path: `test-results/poses/${file}.png` });
      pictures.add(shot.toString('base64'));
      expect(await problemsShown(page)).toEqual([]);
    }
    // Every pose is a different picture.
    expect(pictures.size).toBe(names.length);
  }
});

test('keeps the pose when the race changes', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  await repose(page, () => page.locator('#presets button', { hasText: /^Cheer$/ }).click());
  await redraw(page, () => page.locator('#race').selectOption({ label: 'Orc' }));
  await expect(page.locator('#presets button.on')).toHaveText('Cheer');
});

test('scrubs through any animation', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  const start = await page.locator('#canvas').screenshot();
  await repose(page, () => page.locator('#animation').selectOption({ label: 'EmoteDance' }));
  await expect(page.locator('#time-label')).toContainText('0.00 of');
  // No curated pose is selected once an animation is picked by hand.
  await expect(page.locator('#presets button.on')).toHaveCount(0);
  const first = await page.locator('#canvas').screenshot();
  await repose(page, () => page.locator('#time').fill('900'));
  await expect(page.locator('#time-label')).toContainText('0.90 of');
  const later = await page.locator('#canvas').screenshot({ path: 'test-results/dance.png' });
  expect(first.equals(start)).toBe(false);
  expect(later.equals(first)).toBe(false);
  expect(await problemsShown(page)).toEqual([]);
});

test('plays an animation and saves it as a clip', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  await page.locator('#size').selectOption('youtube');
  await repose(page, () => page.locator('#animation').selectOption({ label: 'EmoteDance' }));
  const canvas = page.locator('#canvas');

  // Playing moves the pose on without anything being touched; pausing holds it.
  await page.locator('#play').click();
  const seen = new Set<string>();
  await expect.poll(async () => seen.add((await canvas.getAttribute('data-pose'))!).size, { timeout: 10_000 }).toBeGreaterThan(3);
  await page.locator('#play').click();
  await expect(page.locator('#play')).toHaveText('Play');
  // The slider settles on the moment the picture stopped at.
  await page.waitForTimeout(300);
  const held = await canvas.getAttribute('data-pose');
  await page.waitForTimeout(500);
  expect(await canvas.getAttribute('data-pose')).toBe(held);

  const save = async (format: string, name: string) => {
    await page.locator('#clip-format').selectOption(format);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-clip').click()]);
    expect(download.suggestedFilename()).toBe(name);
    await download.saveAs(`test-results/${name}`);
    await expect(page.locator('#export-note')).toContainText('Saved');
    console.log(format, await page.locator('#export-note').innerText());
    return readFileSync(`test-results/${name}`);
  };
  const video = await save('mp4', 'mogshot-human-male-emotedance.mp4');
  expect(video.subarray(4, 8).toString('latin1')).toBe('ftyp');
  expect(video.includes('avc1')).toBe(true);
  const gif = await save('gif', 'mogshot-human-male-emotedance.gif');
  expect(gif.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  expect([gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual([800, 450]);
  const zip = await save('frames', 'mogshot-human-male-emotedance.zip');
  expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');

  // The page is back on the moment it was paused at, and nothing is wrong.
  await page.locator('.viewer > div').first().screenshot({ path: 'test-results/clip-controls.png' });
  expect(await canvas.getAttribute('data-pose')).toBe(held);
  expect(await problemsShown(page)).toEqual([]);
});

test('turns, zooms and resets the camera', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  const canvas = page.locator('#canvas');
  const front = await canvas.screenshot();
  const box = (await canvas.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 150, centre.y - 20, { steps: 5 });
  await page.mouse.up();
  const turned = await canvas.screenshot({ path: 'test-results/camera-turned.png' });
  expect(turned.equals(front)).toBe(false);

  await page.mouse.wheel(0, -400);
  const zoomed = await canvas.screenshot({ path: 'test-results/camera-zoomed.png' });
  expect(zoomed.equals(turned)).toBe(false);

  await page.locator('#fov').fill('60');
  const wide = await canvas.screenshot({ path: 'test-results/camera-wide.png' });
  expect(wide.equals(zoomed)).toBe(false);

  await page.locator('#reset-view').click();
  expect((await canvas.screenshot()).equals(front)).toBe(true);
});

test('copies the picture to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page, false);
  await openAndDraw(page);
  await page.locator('#size').selectOption('youtube');
  await page.locator('#copy').click();
  await expect(page.locator('#export-note')).toContainText('Copied 1,280 × 720');
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item!.getType('image/png');
    const bitmap = await createImageBitmap(blob);
    return { types: item!.types, bytes: blob.size, width: bitmap.width, height: bitmap.height };
  });
  expect(copied.types).toContain('image/png');
  expect([copied.width, copied.height]).toEqual([1280, 720]);
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

test('remembers the character and opens quickly on a return visit, even offline', async ({ page }) => {
  test.setTimeout(180_000);
  await load(page, false);
  await openAndDraw(page);
  const firstIndexing = Number((await page.locator('#indexed').innerText()).match(/[\d.]+/)![0]);
  await redraw(page, () => page.locator('#race').selectOption({ label: 'Orc' }));
  await repose(page, () => page.locator('#presets button', { hasText: /^Cheer$/ }).click());
  await equip(page, 'head', 'Lionheart Helm');
  await page.locator('#size').selectOption('square');
  // Colour options are swatches; picking one changes the picture.
  const skin = page.locator('.swatches[data-option="Skin Color"] button');
  expect(await skin.count()).toBeGreaterThan(3);
  const before = await page.locator('#canvas').screenshot();
  await redraw(page, () => skin.nth(3).click());
  expect((await page.locator('#canvas').screenshot()).equals(before)).toBe(false);
  await expect(skin.nth(3)).toHaveAttribute('aria-checked', 'true');

  // Back later, with no network: the index and the table definitions come from the cache.
  await page.reload({ waitUntil: 'networkidle' });
  await page.context().setOffline(true);
  await openAndDraw(page);
  await expect(page.locator('#indexed')).toContainText('from an earlier visit');
  const secondIndexing = Number((await page.locator('#indexed').innerText()).match(/[\d.]+/)![0]);
  console.log(`indexed in ${firstIndexing} s, then ${secondIndexing} s from the cache`);
  expect(secondIndexing).toBeLessThan(Math.max(0.3, firstIndexing / 3));
  await expect(page.locator('#race option:checked')).toHaveText('Orc');
  await expect(page.locator('#presets button.on')).toHaveText('Cheer');
  await expect(page.locator('[data-slot="head"] .item-name')).toHaveText('Lionheart Helm');
  await expect(page.locator('#size option:checked')).toContainText('Square');
  await expect(skin.nth(3)).toHaveAttribute('aria-checked', 'true');
  expect(await problemsShown(page)).toEqual([]);
  await page.context().setOffline(false);
});

test('offers to try again when the table definitions could not be fetched', async ({ page }) => {
  await load(page, true);
  await page.locator('#folder').setInputFiles(WOW_DIR);
  await expect(page.locator('#character-error')).toContainText('could not be drawn');
  await page.context().setOffline(false);
  await page.locator('#retry').click();
  await expect(page.locator('#character-note')).toContainText('Built in', { timeout: 60_000 });
  await expect(page.locator('#character-error')).toHaveCount(0);
});

test('random look, random epics, and the best set for a class', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  const canvas = page.locator('#canvas');

  const plain = await canvas.screenshot();
  await redraw(page, () => page.locator('#random-look').click());
  // A random look is almost surely a different picture; the options show the new choices.
  expect((await canvas.screenshot()).equals(plain)).toBe(false);
  await redraw(page, () => page.locator('#default-look').click());
  await expect(page.locator('select[data-option="Hair Style"] option:checked')).toHaveText('Bald');

  await redraw(page, () => page.locator('#random-epics').click());
  const worn = page.locator('#gear .slot-pick canvas.icon');
  expect(await worn.count()).toBeGreaterThanOrEqual(10);
  for (const slot of ['head', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet', 'mainHand']) {
    await expect(page.locator(`[data-slot="${slot}"] .item-name`)).not.toHaveText('Empty');
  }
  expect(await problemsShown(page)).toEqual([]);
  await canvas.screenshot({ path: 'test-results/random-epics.png' });

  await page.locator('#class').selectOption({ label: 'Warrior' });
  await expect(page.locator('#set option')).not.toHaveCount(1);
  await redraw(page, () => page.locator('#best-set').click());
  await expect(page.locator('[data-slot="chest"] .item-name')).toHaveText(/Battlegear|Armor|Breastplate|Dreadnaught/);
  const chest = await page.locator('[data-slot="chest"] .item-name').innerText();
  console.log('best warrior set chest piece:', chest);
  // A set comes with a weapon, and replaces the off hand the random outfit may have filled.
  await expect(page.locator('[data-slot="mainHand"] .item-name')).not.toHaveText('Empty');
  await expect(page.locator('[data-slot="offHand"] .item-name')).toHaveText('Empty');
  expect(await problemsShown(page)).toEqual([]);
  await canvas.screenshot({ path: 'test-results/best-set.png' });

  await page.locator('#class').selectOption({ label: 'Mage' });
  const frostfire = await page.locator('#set option', { hasText: 'Frostfire Regalia' }).getAttribute('value');
  await redraw(page, () => page.locator('#set').selectOption(frostfire!));
  await expect(page.locator('[data-slot="chest"] .item-name')).toHaveText('Frostfire Robe');
  await expect(page.locator('[data-slot="mainHand"] .item-name')).not.toHaveText('Empty');
  expect(await problemsShown(page)).toEqual([]);
  await canvas.screenshot({ path: 'test-results/frostfire-set.png' });

  await redraw(page, () => page.locator('#clear-gear').click());
  await expect(page.locator('[data-slot="chest"] .item-name')).toHaveText('Empty');
});

/** A warrior orc female wearing Lionheart Helm and Thunderfury, as the addon would encode her. */
const ORC_CODE = 'MOG2;Thrall-Whitemane;2;1;1;H9r4Meob;';

test('imports a character from a pasted code and keeps the look given to her', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  await page.locator('#paste-toggle').click();
  await redraw(page, () => page.locator('#import-code').fill(ORC_CODE));
  await expect(page.locator('#race option:checked')).toHaveText('Orc');
  await expect(page.locator('#sex button.on')).toHaveText('Female');
  await expect(page.locator('#class option:checked')).toHaveText('Warrior');
  await expect(page.locator('[data-slot="head"] .item-name')).toHaveText('Lionheart Helm');
  await expect(page.locator('[data-slot="mainHand"] .item-name')).toHaveText('Thunderfury, Blessed Blade of the Windseeker');
  await expect(page.locator('#import-note')).toContainText('2 of 2 items found');
  await expect(page.locator('#import-note')).toContainText('skin, hair and face not captured');
  expect(await problemsShown(page)).toEqual([]);
  await page.locator('#canvas').screenshot({ path: 'test-results/imported.png' });
  await page.screenshot({ path: 'test-results/page-imported.png', fullPage: true });

  // The look is set by eye, and a second import of the same character keeps it.
  const hair = page.locator('select[data-option="Hair Style"]');
  await redraw(page, () => hair.selectOption({ index: 3 }));
  const chosen = await hair.locator('option:checked').textContent();
  await page.locator('#import-code').fill('');
  await redraw(page, () => page.locator('#import-code').fill(ORC_CODE));
  await expect(hair.locator('option:checked')).toHaveText(chosen!);
  // Choosing a race by hand means the character is no longer the imported one.
  await redraw(page, () => page.locator('#race').selectOption({ label: 'Human' }));
  await expect(page.locator('#imported')).toHaveValue('');

  await page.locator('#import-code').fill('nonsense');
  await expect(page.locator('#import-note')).toContainText('not a Mogshot code');
});

test('lists the characters the addon captured in the game folder', async ({ page }) => {
  const saved = globSync(`${WOW_DIR}/_*_/WTF/Account/*/SavedVariables/Mogshot.lua`);
  test.skip(saved.length === 0, 'the Mogshot addon has not saved any character here');
  await load(page, false);
  await openAndDraw(page);
  const options = page.locator('#imported option');
  expect(await options.count()).toBeGreaterThan(1);
  const first = await options.nth(1).getAttribute('value');
  console.log('captured characters:', await options.allTextContents());
  await redraw(page, () => page.locator('#imported').selectOption(first!));
  await expect(page.locator('#import-note')).toContainText('items found');
  await expect(page.locator('#imported')).toHaveValue(first!);
  console.log('import note:', await page.locator('#import-note').innerText());
  console.log('problems:', await problemsShown(page));
  await page.screenshot({ path: 'test-results/page-own-character.png', fullPage: true });
});

test('puts a backdrop behind the character, saves it on its own, and remembers it', async ({ page }) => {
  await load(page, false);
  await openAndDraw(page);
  await page.locator('#size').selectOption('youtube');

  const saveAs = async (button: string, file: string, name: RegExp) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator(button).click()]);
    expect(download.suggestedFilename()).toMatch(name);
    const path = `test-results/${file}.png`;
    await download.saveAs(path);
    await expect(page.locator('#export-note')).toContainText('Saved');
    console.log(file, await page.locator('#export-note').innerText());
    return decodePng(readFileSync(path));
  };
  const opaque = (image: ReturnType<typeof decodePng>) => {
    let clear = 0;
    for (let i = 3; i < image.pixels.length; i += 4) if (image.pixels[i] !== 255) clear++;
    return clear === 0;
  };
  const pixel = (image: ReturnType<typeof decodePng>, x: number, y: number) => [...image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];

  // A gradient: the picture is opaque, at the preset's size, dark red at the corners.
  await page.locator('#backdrop-kind').selectOption('gradient:Ember');
  await expect(page.locator('#canvas')).toHaveAttribute('data-backdrop', 'ember');
  await expect(page.locator('.hint')).toContainText('part of the picture');
  const withGradient = await saveAs('#download', 'backdrop-gradient', /^mogshot-human-male\.png$/);
  expect([withGradient.width, withGradient.height]).toEqual([1280, 720]);
  expect(opaque(withGradient)).toBe(true);
  const [r, g, b] = pixel(withGradient, 0, 0) as [number, number, number];
  expect(r).toBeGreaterThan(g);
  expect(r).toBeLessThan(100);
  expect(g).toBeLessThan(50);
  expect(b).toBeLessThan(50);

  // The backdrop alone is the same size and matches the picture where the character is not.
  const alone = await saveAs('#download-backdrop', 'backdrop-only', /^mogshot-backdrop-ember\.png$/);
  expect([alone.width, alone.height]).toEqual([1280, 720]);
  expect(opaque(alone)).toBe(true);
  for (const [x, y] of [[0, 0], [1279, 0], [0, 719], [1279, 719]] as const) {
    const a = pixel(alone, x, y);
    const b = pixel(withGradient, x, y);
    for (let c = 0; c < 3; c++) expect(Math.abs(a[c]! - b[c]!)).toBeLessThanOrEqual(2);
  }

  // The tight preset saves the whole preview when there is a backdrop.
  await page.locator('#size').selectOption('tight');
  const tall = await saveAs('#download', 'backdrop-tight', /^mogshot-human-male\.png$/);
  expect([tall.width, tall.height]).toEqual([2880, 3840]);
  expect(opaque(tall)).toBe(true);
  await page.locator('#size').selectOption('youtube');

  // A loading screen by name, blurred and vignetted.
  const names = await page.locator('#backdrop-kind optgroup[label="Loading screen"] option').allTextContents();
  console.log('loading screens offered:', names.length);
  expect(names.length).toBeGreaterThan(40);
  const kalimdor = names.find((name) => name.startsWith('Kalimdor'));
  expect(kalimdor).toBeDefined();
  await page.locator('#backdrop-kind').selectOption({ label: kalimdor! });
  await expect(page.locator('#canvas')).toHaveAttribute('data-backdrop', /^kalimdor/);
  await expect(page.locator('#backdrop-note')).toHaveCount(0);
  await page.locator('#blur').fill('12');
  await page.locator('#vignette').fill('60');
  await page.locator('#canvas').screenshot({ path: 'test-results/backdrop-kalimdor.png' });
  const withScreen = await saveAs('#download', 'backdrop-screen', /^mogshot-human-male\.png$/);
  expect(opaque(withScreen)).toBe(true);
  // The vignette darkens the corner well below the middle of the top edge.
  const corner = pixel(withScreen, 0, 0).reduce((s, v) => s + v, 0);
  const topMiddle = pixel(withScreen, 640, 0).reduce((s, v) => s + v, 0);
  expect(corner).toBeLessThan(topMiddle);
  await saveAs('#download-backdrop', 'backdrop-screen-only', /^mogshot-backdrop-kalimdor/);

  // A classic 4:3 screen and the clipboard still work.
  const deadmines = names.find((name) => name.startsWith('Deadmines'));
  await page.locator('#backdrop-kind').selectOption({ label: deadmines! });
  await expect(page.locator('#canvas')).toHaveAttribute('data-backdrop', 'deadmines');
  await page.locator('#canvas').screenshot({ path: 'test-results/backdrop-deadmines.png' });

  // The backdrop is remembered for the next visit.
  await page.reload();
  await openAndDraw(page);
  await expect(page.locator('#backdrop-kind')).toHaveValue(/^screen:/);
  await expect(page.locator('#canvas')).toHaveAttribute('data-backdrop', 'deadmines');
  await expect(page.locator('#blur')).toHaveValue('12');

  // Back to transparent.
  await page.locator('#backdrop-kind').selectOption('none');
  await expect(page.locator('#canvas')).toHaveAttribute('data-backdrop', '');
  await expect(page.locator('#download-backdrop')).toHaveCount(0);
  await expect(page.locator('.hint')).toContainText('transparency');
});

test('makes a backdrop on its own tab, before any folder is opened', async ({ page }) => {
  await load(page, false);
  await page.locator('#tab-backdrop').click();
  await expect(page.locator('#backdrop-tab')).toBeVisible();
  await expect(page.locator('#backdrop-download')).toBeDisabled();
  await expect(page.locator('#backdrop-folder-note')).toContainText('drag your World of Warcraft folder');

  // A gradient needs no game files.
  await page.locator('#backdrop-kind').selectOption('gradient:Frost');
  await expect(page.locator('#backdrop-canvas')).toHaveAttribute('data-backdrop', 'frost');
  await page.locator('#backdrop-size').selectOption('1080p');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#backdrop-download').click()]);
  expect(download.suggestedFilename()).toBe('mogshot-backdrop-frost.png');
  await download.saveAs('test-results/backdrop-tab-frost.png');
  await expect(page.locator('#backdrop-export-note')).toContainText('Saved 1,920 × 1,080');
  const saved = decodePng(readFileSync('test-results/backdrop-tab-frost.png'));
  expect([saved.width, saved.height]).toEqual([1920, 1080]);
  for (let i = 3; i < saved.pixels.length; i += 4001 * 4) expect(saved.pixels[i]).toBe(255);
  await page.screenshot({ path: 'test-results/page-backdrop-tab.png', fullPage: true });

  // The same backdrop is behind the character on the other tab once the folder is open.
  await page.locator('#tab-character').click();
  await openAndDraw(page);
  await expect(page.locator('#canvas')).toHaveAttribute('data-backdrop', 'frost');

  // The folder adds the game's loading screens to the Backdrop tab.
  await page.locator('#tab-backdrop').click();
  await expect(page.locator('#backdrop-folder-note')).toHaveCount(0);
  const names = await page.locator('#backdrop-kind optgroup[label="Loading screen"] option').allTextContents();
  expect(names.length).toBeGreaterThan(40);
  await page.locator('#backdrop-kind').selectOption({ label: names.find((name) => name.startsWith('Kalimdor'))! });
  await expect(page.locator('#backdrop-canvas')).toHaveAttribute('data-backdrop', /^kalimdor/);
  await page.screenshot({ path: 'test-results/page-backdrop-tab-screen.png', fullPage: true });
  await page.locator('#tab-character').click();
  await expect(page.locator('#canvas')).toHaveAttribute('data-backdrop', /^kalimdor/);
  await expect(page.locator('#backdrop-kind')).toHaveCount(1);

  // A link can open the tab, and the backdrop is remembered.
  await page.goto('./#backdrop');
  await expect(page.locator('#backdrop-tab')).toBeVisible();
  await expect(page.locator('#backdrop-kind')).toHaveValue(/^screen:/);
});
