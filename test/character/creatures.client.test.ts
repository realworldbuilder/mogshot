import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { Creatures } from '../../src/character/creatures';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import { parseCreatureCache } from '../../src/import/creature-cache';
import { cachedFetch } from '../cached-fetch';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('creatures', () => {
  let storage: CascStorage;
  let creatures: Creatures;

  beforeAll(async () => {
    storage = await CascStorage.open(new NodeSource(WOW_DIR));
    const definitions = new Definitions(async (url) => {
      const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
      if (text === undefined) throw new Error(`Could not fetch ${url}`);
      return text;
    });
    creatures = await Creatures.load(new Database(storage, definitions));
  }, 120_000);

  it('reads Tyrande Whisperwind as a night elf female with her choices, gear and painted body', () => {
    const display = creatures.display(7274)!;
    expect(display).toMatchObject({ id: 7274, modelFileId: 921844, scale: 1 });
    const { humanoid } = display;
    expect(humanoid).toBeDefined();
    expect(humanoid!.extraId).toBe(4964);
    expect(humanoid!.raceId).toBe(4);
    expect(humanoid!.sex).toBe(1);
    expect(Object.fromEntries(humanoid!.wear)).toEqual({ head: 24525, shirt: 25537, legs: 25538, hands: 24922 });
    expect(humanoid!.choices.size).toBe(10);
    expect(humanoid!.choices.get(8529)).toBe(54371);
    expect(humanoid!.bakeFileId).toBe(1015555);
    expect(humanoid!.hdBakeFileId).toBe(1015556);
    expect(storage.files.find(humanoid!.hdBakeFileId)).toBeDefined();
  });

  it('reads a plain creature (the Living Flame) with its own model and textures', () => {
    const display = creatures.display(1405)!;
    expect(display.humanoid).toBeUndefined();
    expect(display.modelFileId).toBeGreaterThan(0);
    expect(display.textures.length).toBeLessThanOrEqual(3);
    expect(display.textures[0]).toBeGreaterThan(0);
  });

  it('names the pets the game files list', () => {
    expect(creatures.creatures.length).toBeGreaterThan(100);
    const squirrel = creatures.creatures.find((c) => c.name === 'Mechanical Squirrel');
    expect(squirrel).toBeDefined();
    expect(squirrel!.displays[0]!.id).toBeGreaterThan(0);
    expect(creatures.display(squirrel!.displays[0]!.id)).toBeDefined();
  });

  it("parses the install's creature cache in full, and every display it names is in the game data", (ctx) => {
    const path = join(WOW_DIR, `_${storage.info.product.replace(/^wow_/, '')}_`, 'Cache', 'WDB', storage.info.locale, 'creaturecache.wdb');
    if (!existsSync(path)) return ctx.skip();
    const cache = parseCreatureCache(new Uint8Array(readFileSync(path)));
    expect(cache.locale).toBe(storage.info.locale);
    expect(cache.entries.length).toBeGreaterThan(0);
    const unknown = cache.entries.flatMap((entry) => entry.displays.filter((d) => !creatures.display(d.id)).map((d) => `${entry.name} -> ${d.id}`));
    expect(unknown).toEqual([]);
    for (const entry of cache.entries) expect(entry.name).not.toBe('');
  });
});
