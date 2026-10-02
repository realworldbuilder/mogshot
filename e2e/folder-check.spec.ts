import { expect, test } from '@playwright/test';
import { hasClient, WOW_DIR } from '../test/node-source';

// Needs a game install. Reported as skipped, not passed, when there is none.
test.skip(!hasClient, 'no game install at WOW_DIR');

test('reads the install in the browser with the network off', async ({ page, context }) => {
  const requests: string[] = [];
  await page.goto('./', { waitUntil: 'networkidle' });

  await context.setOffline(true);
  page.on('request', (request) => requests.push(request.url()));

  await page.locator('#fallback').setInputFiles(WOW_DIR);
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

  // Nothing was fetched after the folder was picked.
  expect(requests).toEqual([]);

  // Kept for looking at the page by eye; test-results/ is not committed.
  await page.screenshot({ path: 'test-results/folder-check.png', fullPage: true });
  console.log((await page.locator('#result').innerText()).replace(/\n+/g, '\n'));
});
