import { join } from 'node:path';
import { CascStorage } from '../src/casc/storage';
import { Appearance } from '../src/character/appearance';
import { type LoadingScreen, loadLoadingScreens } from '../src/character/backdrops';
import { Creatures } from '../src/character/creatures';
import { type ClassInfo, Equipment } from '../src/character/equipment';
import { Database } from '../src/db2/database';
import { Definitions } from '../src/db2/definitions';
import { decodeBlp, type Image } from '../src/formats/blp';
import { type CachedCreature, parseCreatureCache } from '../src/import/creature-cache';
import { type ImportedRecord, mergeRecords, recordsFromSavedVariables } from '../src/import/record';
import { type ByteSource, readText } from '../src/io/byte-source';
import { NodeSource } from '../src/io/node-source';
import { FileCache } from './file-cache';
import { CachedSource, remoteFolder, SshSource } from './ssh-source';

/** A map of the game world: a continent, or an instance with its own outdoors. */
export interface MapInfo {
  id: number;
  name: string;
  directory: string;
  wdtFileId: number;
}

/** The NPCs the game has shown this computer, read from the client's creature cache files. */
export interface SeenCreatures {
  entries: CachedCreature[];
  /** Anything about the files worth saying: a cache from another build, for one. */
  notes: string[];
}

/** An open game folder and what has been read from it so far. The command line's counterpart of the page's data worker. */
export class Session {
  private appearancePromise: Promise<Appearance> | undefined;
  private equipmentPromise: Promise<Equipment> | undefined;
  private screensPromise: Promise<LoadingScreen[]> | undefined;
  private recordsPromise: Promise<ImportedRecord[]> | undefined;
  private mapsPromise: Promise<MapInfo[]> | undefined;
  private creaturesPromise: Promise<Creatures> | undefined;
  private seenPromise: Promise<SeenCreatures> | undefined;

  private constructor(
    readonly source: ByteSource,
    readonly storage: CascStorage,
    private readonly database: Database,
  ) {}

  /**
   * Opens a game folder: a path on this computer, or "host:/path" for one on another computer
   * reached by ssh. `product` picks one of the folder's products (wow, wow_classic_beta, ...).
   */
  static async open(location: string, cacheDir: string, product?: string): Promise<Session> {
    const cache = new FileCache(cacheDir);
    const remote = remoteFolder(location);
    const source = remote
      ? new CachedSource(new SshSource(remote.host, remote.root), join(cacheDir, 'remote', remote.host))
      : new NodeSource(location);
    const storage = await CascStorage.open(source, { cache, product });
    const definitions = new Definitions(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return response.text();
    }, cache);
    return new Session(source, storage, new Database(storage, definitions));
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

  creatures(): Promise<Creatures> {
    return (this.creaturesPromise ??= Creatures.load(this.database));
  }

  /**
   * The NPCs this computer has seen in the game, from every product's creature cache: the
   * install's locale first, else whatever locales the cache folder has. A cache written by
   * another build is kept, with a note, since names and display ids rarely change.
   */
  creatureCache(): Promise<SeenCreatures> {
    return (this.seenPromise ??= (async () => {
      const build = Number(this.storage.info.version.split('.').pop());
      const seen: SeenCreatures = { entries: [], notes: [] };
      const ids = new Set<number>();
      for (const product of await this.source.list('')) {
        if (!/^_.+_$/.test(product)) continue;
        const wdb = `${product}/Cache/WDB`;
        const locales = (await this.source.list(wdb)).includes(this.storage.info.locale) ? [this.storage.info.locale] : await this.source.list(wdb);
        for (const locale of locales) {
          const path = `${wdb}/${locale}/creaturecache.wdb`;
          let bytes: Uint8Array;
          try {
            bytes = await this.source.read(path);
          } catch {
            continue;
          }
          try {
            const cache = parseCreatureCache(bytes);
            if (cache.build !== build) seen.notes.push(`${path} was written by build ${cache.build}, not ${build}; its NPC names may be out of date`);
            for (const entry of cache.entries) {
              if (ids.has(entry.id)) continue;
              ids.add(entry.id);
              seen.entries.push(entry);
            }
          } catch (cause) {
            seen.notes.push(`${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`);
          }
        }
      }
      return seen;
    })());
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
      for (const product of await this.source.list('')) {
        if (!/^_.+_$/.test(product)) continue;
        const accounts = `${product}/WTF/Account`;
        for (const account of await this.source.list(accounts)) {
          try {
            lists.push(recordsFromSavedVariables(await readText(this.source, `${accounts}/${account}/SavedVariables/Mogshot.lua`)));
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
