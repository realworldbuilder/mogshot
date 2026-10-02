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

  /** `fetchText` resolves a URL to its text; callers add whatever caching suits them. */
  constructor(private readonly fetchText: (url: string) => Promise<string>) {}

  /** File ID of a table's .db2, or undefined if the manifest does not know the table. */
  async fileId(table: string): Promise<number | undefined> {
    this.manifestPromise ??= this.fetchText(`${DEFINITIONS_URL}/manifest.json`).then((text) => {
      const entries = JSON.parse(text) as { tableName: string; db2FileDataID?: number }[];
      const ids = new Map<string, number>();
      for (const entry of entries) {
        if (entry.db2FileDataID) ids.set(entry.tableName, entry.db2FileDataID);
      }
      return ids;
    });
    return (await this.manifestPromise).get(table);
  }

  dbd(table: string): Promise<Dbd> {
    let dbd = this.dbds.get(table);
    if (!dbd) {
      dbd = this.fetchText(`${DEFINITIONS_URL}/definitions/${table}.dbd`).then(parseDbd);
      this.dbds.set(table, dbd);
    }
    return dbd;
  }
}
