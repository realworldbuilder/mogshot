import { open, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ByteSource } from './byte-source';

/** ByteSource over a folder on disk, for running the data layer in Node: the tests and the command line. */
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
