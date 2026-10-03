import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import type { Cache } from '../src/casc/cache';

/** A cache in a folder on disk: what IndexedDB is to the page. Any failure is treated as a miss. */
export class FileCache implements Cache {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    return join(this.dir, createHash('sha1').update(key).digest('hex'));
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      return deserialize(await readFile(this.path(key))) as T;
    } catch {
      return undefined;
    }
  }

  async put(key: string, value: unknown): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(this.path(key), serialize(value));
    } catch {
      // the cache only speeds things up
    }
  }
}
