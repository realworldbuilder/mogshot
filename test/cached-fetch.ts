import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CACHE_DIR = join(import.meta.dirname, '..', 'node_modules', '.cache', 'mogshot');

/**
 * Fetch a URL's text, keeping a copy under node_modules/.cache so tests do not hit the
 * network on every run. Resolves to undefined when the URL can't be fetched and no copy
 * exists, so the caller can skip instead of fail when offline.
 */
export async function cachedFetch(url: string, cacheName: string): Promise<string | undefined> {
  const path = join(CACHE_DIR, cacheName);
  try {
    return await readFile(path, 'utf8');
  } catch {
    // not cached yet
  }
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const text = await response.text();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
    return text;
  } catch {
    return undefined;
  }
}
