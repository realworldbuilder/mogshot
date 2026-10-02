import { existsSync } from 'node:fs';
import { open, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ByteSource } from '../src/io/byte-source';

/** ByteSource over a folder on disk, for running the data layer in Node tests. */
export class NodeSource implements ByteSource {
  constructor(private readonly root: string) {}

  async list(dir: string): Promise<string[]> {
    try {
      return await readdir(join(this.root, dir));
    } catch {
      return [];
    }
  }

  async read(path: string, offset?: number, length?: number): Promise<Uint8Array> {
    const full = join(this.root, path);
    if (offset === undefined || length === undefined) return new Uint8Array(await readFile(full));
    const handle = await open(full, 'r');
    try {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
}

/** The game install used by client-backed tests. Tests are skipped when it is absent. */
export const WOW_DIR = process.env.WOW_DIR ?? '/Applications/World of Warcraft';
export const hasClient = existsSync(join(WOW_DIR, '.build.info'));
