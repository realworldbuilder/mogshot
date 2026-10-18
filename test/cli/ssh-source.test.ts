import { mkdtemp, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CachedSource, remoteFolder, SshSource } from '../../cli/ssh-source';
import type { ByteSource } from '../../src/io/byte-source';

describe('remoteFolder', () => {
  it('reads host:/folder, spaces and all', () => {
    expect(remoteFolder('williams-macbook-pro-2:/Applications/World of Warcraft')).toEqual({ host: 'williams-macbook-pro-2', root: '/Applications/World of Warcraft' });
  });

  it('leaves local paths and drive letters alone', () => {
    expect(remoteFolder('/Applications/World of Warcraft')).toBeUndefined();
    expect(remoteFolder('C:\\Program Files (x86)\\World of Warcraft')).toBeUndefined();
  });
});

describe('SshSource', () => {
  let root: string;
  let source: SshSource;
  const big = new Uint8Array(3_000_000).map((_, i) => i % 251);

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mogshot ssh '"));
    await mkdir(join(root, 'Data', 'data'), { recursive: true });
    await writeFile(join(root, '.build.info'), 'header\nrow\n');
    await writeFile(join(root, 'Data', 'data', 'data.000'), big);
    source = new SshSource(undefined, root);
  });

  afterAll(() => source.close());

  it('lists a folder, and a missing one as empty', async () => {
    expect((await source.list('')).sort()).toEqual(['.build.info', 'Data']);
    expect(await source.list('nowhere')).toEqual([]);
  });

  it('reads whole files and byte ranges, many at once, each answer to its question', async () => {
    const [text, whole, part, again] = await Promise.all([
      source.read('.build.info'),
      source.read('Data/data/data.000'),
      source.read('Data/data/data.000', 1_000_000, 10),
      source.read('.build.info', 7, 3),
    ]);
    expect(new TextDecoder().decode(text)).toBe('header\nrow\n');
    expect(Buffer.compare(whole, big)).toBe(0);
    expect([...part]).toEqual([...big.subarray(1_000_000, 1_000_010)]);
    expect(new TextDecoder().decode(again)).toBe('row');
  });

  it('rejects a missing file and keeps answering', async () => {
    await expect(source.read('missing.txt')).rejects.toThrow(/No such file/);
    expect((await source.read('.build.info', 0, 6)).length).toBe(6);
  });
});

describe('CachedSource', () => {
  it('fetches an archive range once, and passes everything else through', async () => {
    const asked: string[] = [];
    const inner: ByteSource = {
      list: async (dir) => (dir === 'Data/data' ? ['0000000001.idx', 'data.000'] : []),
      read: async (path, offset, length) => {
        asked.push(`${path}@${offset}`);
        return new Uint8Array(length ?? 4).fill(7);
      },
    };
    const cache = await mkdtemp(join(tmpdir(), 'mogshot-cache-'));
    const first = new CachedSource(inner, cache);
    await first.read('Data/data/data.000', 100, 8);
    await first.read('.build.info');
    const second = new CachedSource(inner, cache);
    expect([...(await second.read('Data/data/data.000', 100, 8))]).toEqual(new Array(8).fill(7));
    await second.read('.build.info');
    expect(asked).toEqual(['Data/data/data.000@100', '.build.info@undefined', '.build.info@undefined']);
    expect(await readdir(cache)).toHaveLength(1);
  });
});
