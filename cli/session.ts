import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CascStorage } from '../src/casc/storage';
import { Appearance } from '../src/character/appearance';
import { type LoadingScreen, loadLoadingScreens } from '../src/character/backdrops';
import { type ClassInfo, Equipment } from '../src/character/equipment';
import { Database } from '../src/db2/database';
import { Definitions } from '../src/db2/definitions';
import { decodeBlp, type Image } from '../src/formats/blp';
import { type ImportedRecord, mergeRecords, recordsFromSavedVariables } from '../src/import/record';
import { NodeSource } from '../src/io/node-source';
import { FileCache } from './file-cache';

/** A map of the game world: a continent, or an instance with its own outdoors. */
export interface MapInfo {
  id: number;
  name: string;
  directory: string;
  wdtFileId: number;
}

/** An open game folder and what has been read from it so far. The command line's counterpart of the page's data worker. */
export class Session {
  private appearancePromise: Promise<Appearance> | undefined;
  private equipmentPromise: Promise<Equipment> | undefined;
  private screensPromise: Promise<LoadingScreen[]> | undefined;
  private recordsPromise: Promise<ImportedRecord[]> | undefined;
  private mapsPromise: Promise<MapInfo[]> | undefined;

  private constructor(
    readonly dir: string,
    readonly storage: CascStorage,
    private readonly database: Database,
  ) {}

  static async open(dir: string, cacheDir: string): Promise<Session> {
    const cache = new FileCache(cacheDir);
    const storage = await CascStorage.open(new NodeSource(dir), { cache });
    const definitions = new Definitions(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return response.text();
    }, cache);
    return new Session(dir, storage, new Database(storage, definitions));
  }

  appearance(): Promise<Appearance> {
    return (this.appearancePromise ??= Appearance.load(this.database));
  }

  equipment(): Promise<Equipment> {
    return (this.equipmentPromise ??= Equipment.load(this.database));
  }

  /** The loading screens whose picture this install has. */
  screens(): Promise<LoadingScreen[]> {
    const files = this.storage.files;
    return (this.screensPromise ??= loadLoadingScreens(this.database).then((list) =>
      list.filter((screen) => files.find(screen.fileId) !== undefined),
    ));
  }

  /** The maps that have an outdoor world on disk. */
  maps(): Promise<MapInfo[]> {
    return (this.mapsPromise ??= this.database.table('Map', ['MapName_lang', 'Directory', 'WdtFileDataID']).then((table) =>
      table.rows.flatMap((row) => {
        const wdtFileId = Number(row.WdtFileDataID);
        if (!wdtFileId || this.storage.files.find(wdtFileId) === undefined) return [];
        return [{ id: Number(row.ID), name: String(row.MapName_lang), directory: String(row.Directory), wdtFileId }];
      }),
    ));
  }

  /** Every class some race can be. */
  async classes(): Promise<ClassInfo[]> {
    const [appearance, equipment] = await Promise.all([this.appearance(), this.equipment()]);
    const byId = new Map<number, ClassInfo>();
    for (const race of appearance.races) for (const info of equipment.classes(race.id)) byId.set(info.id, info);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The characters the Mogshot addon has captured, from every product and account in the folder. */
  records(): Promise<ImportedRecord[]> {
    return (this.recordsPromise ??= (async () => {
      const lists: ImportedRecord[][] = [];
      for (const product of await names(this.dir)) {
        if (!/^_.+_$/.test(product)) continue;
        const accounts = join(this.dir, product, 'WTF', 'Account');
        for (const account of await names(accounts)) {
          try {
            lists.push(recordsFromSavedVariables(await readFile(join(accounts, account, 'SavedVariables', 'Mogshot.lua'), 'utf8')));
          } catch {
            // this account has no file from the addon
          }
        }
      }
      return mergeRecords(lists);
    })());
  }

  /** A texture file's pixels, or undefined if it cannot be read. */
  async image(fileId: number): Promise<Image | undefined> {
    const file = await this.storage.readFile(fileId);
    return file && decodeBlp(file.data);
  }
}

async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
