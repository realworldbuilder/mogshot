import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { Appearance } from '../../src/character/appearance';
import { loadPortraits, type Portraits } from '../../src/character/portraits';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import { cachedFetch } from '../cached-fetch';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('portraits of the install', () => {
  let appearance: Appearance;
  let portraits: Portraits;

  beforeAll(async () => {
    const storage = await CascStorage.open(new NodeSource(WOW_DIR));
    const definitions = new Definitions(async (url) => {
      const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
      if (text === undefined) throw new Error(`Could not fetch ${url}`);
      return text;
    });
    const database = new Database(storage, definitions);
    appearance = await Appearance.load(database);
    portraits = await loadPortraits(database, (fileId) => storage.readFile(fileId).then((file) => file?.data), appearance.races, appearance.classes);
  }, 120_000);

  it('has a picture for every race the roster lists, for each sex it has', () => {
    // Checked against retail 12.1.5 as well (over ssh, by hand): Haranir, Highmountain Tauren, Lightforged
    // Draenei, Earthen and Zandalari Trolls only have one once their file names are mapped to the atlas's.
    const missing = appearance.races.flatMap((race) => race.sexes.filter((sex) => !portraits.races[`${race.key}:${sex}`]).map((sex) => `${race.name} (${race.file}) ${sex === 1 ? 'female' : 'male'}`));
    expect(missing).toEqual([]);
    expect(portraits.problems).toEqual([]);
  });

  it('has a picture for every class', () => {
    expect(appearance.classes.filter((c) => !portraits.classes[c.key]).map((c) => c.name)).toEqual([]);
  });

  it('cuts square pictures from the atlas', () => {
    for (const image of Object.values(portraits.races)) {
      expect(image.width).toBeGreaterThanOrEqual(64);
      expect(image.height).toBe(image.width);
    }
  });
});
