import { expect, type Page, test } from '@playwright/test';
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
  await expect(page.locator('#status')).toHaveText('Your game files can be read', { timeout: 60_000 });

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
