import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/casc/cache';
import { Definitions } from '../../src/db2/definitions';

const DBD = 'COLUMNS\nint ID\n\nLAYOUT AAAAAAAA\n$id$ID<32>\n';

describe('Definitions', () => {
  it('fetches a definition once and keeps it in the cache for later visits', async () => {
    const cache = new MemoryCache();
    let fetches = 0;
    const fetchText = async () => {
      fetches++;
      return DBD;
    };
    const first = new Definitions(fetchText, cache);
    await first.dbd('ChrRaces');
    await first.dbd('ChrRaces');
    expect(fetches).toBe(1);
    const later = new Definitions(fetchText, cache);
    expect((await later.dbd('ChrRaces')).layouts[0]!.layoutHashes).toEqual(['AAAAAAAA']);
    expect(fetches).toBe(1);
  });

  it('fetches anew on refresh', async () => {
    const cache = new MemoryCache();
    let fetches = 0;
    const definitions = new Definitions(async () => {
      fetches++;
      return DBD.replace('AAAAAAAA', `HASH000${fetches}`);
    }, cache);
    expect((await definitions.dbd('Item')).layouts[0]!.layoutHashes).toEqual(['HASH0001']);
    expect((await definitions.refresh('Item')).layouts[0]!.layoutHashes).toEqual(['HASH0002']);
    expect((await definitions.dbd('Item')).layouts[0]!.layoutHashes).toEqual(['HASH0002']);
  });

  it('reads the manifest for file IDs', async () => {
    const definitions = new Definitions(async () => JSON.stringify([{ tableName: 'ChrRaces', db2FileDataID: 1305311 }, { tableName: 'Old' }]));
    expect(await definitions.fileId('ChrRaces')).toBe(1305311);
    expect(await definitions.fileId('Old')).toBeUndefined();
    expect(await definitions.fileId('Nope')).toBeUndefined();
  });

  it('forgets a failed fetch so the next call can succeed', async () => {
    let online = false;
    const definitions = new Definitions(async (url) => {
      if (!online) throw new Error('Failed to fetch');
      return url.endsWith('manifest.json') ? JSON.stringify([{ tableName: 'ChrRaces', db2FileDataID: 1 }]) : DBD;
    });
    await expect(definitions.fileId('ChrRaces')).rejects.toThrow('Failed to fetch');
    await expect(definitions.dbd('ChrRaces')).rejects.toThrow('Failed to fetch');
    online = true;
    expect(await definitions.fileId('ChrRaces')).toBe(1);
    expect((await definitions.dbd('ChrRaces')).layouts).toHaveLength(1);
  });
});
