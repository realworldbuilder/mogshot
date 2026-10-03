import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { loadLoadingScreens, type LoadingScreen } from '../../src/character/backdrops';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import { decodeBlp } from '../../src/formats/blp';
import { cachedFetch } from '../cached-fetch';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('loading screens in the install', () => {
  let storage: CascStorage;
  let screens: LoadingScreen[];

  beforeAll(async () => {
    storage = await CascStorage.open(new NodeSource(WOW_DIR));
    const database = new Database(
      storage,
      new Definitions(async (url) => {
        const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
        if (text === undefined) throw new Error(`Could not fetch ${url}`);
        return text;
      }),
    );
    screens = await loadLoadingScreens(database);
  }, 120_000);

  it('lists named screens, most of them with a map name', () => {
    console.log(screens.map((s) => `${s.name} (${s.wide ? 'wide' : '4:3'}, file ${s.fileId})`).join('\n'));
    expect(screens.length).toBeGreaterThan(40);
    const named = screens.filter((s) => !s.name.startsWith('Loading screen '));
    expect(named.length).toBeGreaterThan(screens.length / 2);
    expect(screens.map((s) => s.fileId)).toEqual([...new Set(screens.map((s) => s.fileId))]);
  });

  it('reads and decodes every screen, and says which it cannot', { timeout: 120_000 }, async () => {
    const unreadable: string[] = [];
    const sizes = new Map<string, number>();
    for (const screen of screens) {
      const file = await storage.readFile(screen.fileId);
      if (!file) {
        unreadable.push(`${screen.name}: file ${screen.fileId} not on disk`);
        continue;
      }
      const image = decodeBlp(file.data);
      const size = `${image.width}×${image.height}`;
      sizes.set(size, (sizes.get(size) ?? 0) + 1);
      expect(image.pixels.length).toBe(image.width * image.height * 4);
    }
    console.log('sizes:', [...sizes].map(([size, count]) => `${count} at ${size}`).join(', '));
    if (unreadable.length > 0) console.log('unreadable:', unreadable.join('; '));
    // A few may be missing from a partial install; most must be there.
    expect(unreadable.length).toBeLessThan(screens.length / 4);
  });
});
