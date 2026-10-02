import type { Cache } from '../casc/cache';
import { type Dbd, parseDbd } from './dbd';

/** Where table definitions come from. wowdev/WoWDBDefs on GitHub allows cross-origin reads. */
export const DEFINITIONS_URL = 'https://raw.githubusercontent.com/wowdev/WoWDBDefs/master';

/**
 * Table definitions and the table-name -> file ID manifest, fetched when first needed.
 * Definitions are not bundled: a new game build can change a table's layout, and the
 * community definitions catch up without a new release of this app.
 */
export class Definitions {
  private manifestPromise: Promise<Map<string, number>> | undefined;
  private readonly dbds = new Map<string, Promise<Dbd>>();

  /**
   * `fetchText` resolves a URL to its text. With a cache, text fetched once is kept, so a
   * returning user does not need the network; `refresh` fetches again when a cached
   * definition turns out to be too old for the game build.
   */
  constructor(
    private readonly fetchText: (url: string) => Promise<string>,
    private readonly cache?: Cache,
  ) {}

  private async text(url: string, fresh = false): Promise<string> {
    const key = `text|${url}`;
    if (!fresh) {
      const cached = await this.cache?.get<string>(key);
      if (cached !== undefined) return cached;
    }
    const text = await this.fetchText(url);
    await this.cache?.put(key, text);
    return text;
  }

  /** File ID of a table's .db2, or undefined if the manifest does not know the table. */
  async fileId(table: string): Promise<number | undefined> {
    this.manifestPromise ??= this.text(`${DEFINITIONS_URL}/manifest.json`)
      .then((text) => {
        const entries = JSON.parse(text) as { tableName: string; db2FileDataID?: number }[];
        const ids = new Map<string, number>();
        for (const entry of entries) {
          if (entry.db2FileDataID) ids.set(entry.tableName, entry.db2FileDataID);
        }
        return ids;
      })
      .catch((error: unknown) => {
        // A failed fetch (offline, say) is not remembered: the next call tries again.
        this.manifestPromise = undefined;
        throw error;
      });
    return (await this.manifestPromise).get(table);
  }

  dbd(table: string): Promise<Dbd> {
    let dbd = this.dbds.get(table);
    if (!dbd) {
      dbd = this.text(`${DEFINITIONS_URL}/definitions/${table}.dbd`)
        .then(parseDbd)
        .catch((error: unknown) => {
          this.dbds.delete(table);
          throw error;
        });
      this.dbds.set(table, dbd);
    }
    return dbd;
  }

  /** Fetch a table's definition anew, bypassing the cache. */
  refresh(table: string): Promise<Dbd> {
    const dbd = this.text(`${DEFINITIONS_URL}/definitions/${table}.dbd`, true).then(parseDbd);
    this.dbds.set(table, dbd);
    return dbd;
  }
}
