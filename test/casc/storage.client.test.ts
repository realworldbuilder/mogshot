import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/casc/cache';
import { CascStorage } from '../../src/casc/storage';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

const magic = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(0, 4));

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('CascStorage against the local install', () => {
  let storage: CascStorage;
  let openMs = 0;

  beforeAll(async () => {
    const start = performance.now();
    storage = await CascStorage.open(new NodeSource(WOW_DIR));
    openMs = performance.now() - start;
    console.log(
      `opened ${storage.info.product} ${storage.info.version} (${storage.info.locale}) in ${openMs.toFixed(0)} ms`,
      storage.files.stats,
    );
  }, 120_000);

  it('names the product and build', () => {
    expect(storage.info.product).not.toBe('');
    expect(storage.info.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(storage.info.buildName).toContain(storage.info.version.split('.')[3]);
  });

  it('finds nearly every listed file on disk', () => {
    const { listed, onDisk } = storage.files.stats;
    expect(listed).toBeGreaterThan(500_000);
    expect(onDisk / listed).toBeGreaterThan(0.99);
    expect(storage.files.ids.length).toBe(onDisk);
    expect(storage.files.missing.length).toBe(listed - onDisk);
  });

  it('matches the numbers measured for build 1.60.1.70170', (ctx) => {
    if (storage.info.version !== '1.60.1.70170') return ctx.skip();
    expect(storage.files.stats).toEqual({
      listed: 1_436_193,
      onDisk: 1_434_424,
      highResListed: 96_697,
      highResOnDisk: 42,
    });
  });

  it('reads ChrRaces.db2', async () => {
    const file = await storage.readFile(1305311);
    expect(file).toBeDefined();
    expect(magic(file!.data)).toMatch(/^WDC\d$/);
    expect(file!.encrypted).toEqual([]);
  });

  it('reads the human male model', async () => {
    const file = await storage.readFile(1011653);
    expect(file).toBeDefined();
    expect(magic(file!.data)).toBe('MD21');
  });

  it('reads a texture', async () => {
    const file = await storage.readFile(3537040);
    expect(file).toBeDefined();
    expect(magic(file!.data)).toBe('BLP2');
  });

  it('reports encrypted chunks instead of failing', async () => {
    const file = await storage.readFile(1572924); // ItemSparse.db2
    expect(file).toBeDefined();
    expect(magic(file!.data)).toMatch(/^WDC\d$/);
    for (const chunk of file!.encrypted) expect(chunk.keyName).toMatch(/^[0-9A-F]{16}$/);
  });

  it('returns undefined for a file that is not on disk', async () => {
    expect(await storage.readFile(0x7fffffff)).toBeUndefined();
    const missing = storage.files.missing[0];
    if (missing !== undefined) {
      expect(storage.files.isMissing(missing)).toBe(true);
      expect(await storage.readFile(missing)).toBeUndefined();
    }
  });

  it('opens within the first-load budget', () => {
    expect(openMs).toBeLessThan(30_000);
  });

  it('opens again from the cache with the same index, much faster', async () => {
    const cache = new MemoryCache();
    const first = await CascStorage.open(new NodeSource(WOW_DIR), { cache });
    expect(first.info.fromCache).toBe(false);
    const start = performance.now();
    const second = await CascStorage.open(new NodeSource(WOW_DIR), { cache });
    const ms = performance.now() - start;
    console.log(`reopened from cache in ${ms.toFixed(0)} ms`);
    expect(second.info.fromCache).toBe(true);
    expect(second.files.stats).toEqual(first.files.stats);
    expect(second.files.find(1011653)).toEqual(first.files.find(1011653));
    expect(ms).toBeLessThan(openMs / 2);
    expect((await second.readFile(1305311))!.data.subarray(0, 4)).toEqual((await first.readFile(1305311))!.data.subarray(0, 4));
  }, 120_000);
});
