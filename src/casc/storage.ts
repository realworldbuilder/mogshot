import { type ByteSource, readText } from '../io/byte-source';
import { type BlteResult, decodeBlte } from './blte';
import { type BuildInfoEntry, parseBuildInfo } from './build-info';
import type { Cache } from './cache';
import { fromHex } from './bytes';
import { configPath, parseConfig } from './config';
import { Encoding } from './encoding';
import { buildFileIndex, FileIndex, type FileIndexStats } from './file-index';
import { type ArchiveLocation, archivePath, currentIndexFiles, loadLocalIndex } from './local-index';
import { LOCALE_FLAGS, localeFromTags } from './locale';

/** Each entry in a data archive starts with a 30-byte header before its BLTE container. */
const ARCHIVE_ENTRY_HEADER = 30;

export interface StorageInfo {
  product: string;
  /** e.g. "1.60.1.70170" */
  version: string;
  /** e.g. "WOW-70170patch1.60.1_Beta" */
  buildName: string;
  buildKey: string;
  locale: string;
  /** The file index came from the cache of an earlier visit. */
  fromCache: boolean;
}

export type OpenStage = 'config' | 'index' | 'encoding' | 'root' | 'join';

export interface OpenOptions {
  /** Which product to open when the folder holds several. Defaults to the first active one. */
  product?: string;
  onProgress?: (stage: OpenStage) => void;
  /** Keeps the file index between visits, so a returning user skips reading the encoding and root files. */
  cache?: Cache;
}

/** The file index as stored in the cache. */
interface StoredIndex {
  ids: Uint32Array;
  archives: Uint16Array;
  offsets: Uint32Array;
  sizes: Uint32Array;
  flags: Uint8Array;
  missing: Uint32Array;
  stats: FileIndexStats;
}

/** The folder is not a WoW install, or not one we can read. The message is shown to the user. */
export class InstallError extends Error {}

/** Why a folder with these top-level entries is not a readable WoW folder. */
export function notInstallMessage(rootNames: string[]): string {
  const names = rootNames.map((name) => name.toLowerCase());
  const hint =
    names.includes('data') && names.includes('config')
      ? ' You picked the Data folder; pick the folder that contains it.'
      : names.some((name) => /^_.+_$/.test(name)) || names.includes('data')
        ? ' The folder looks like a WoW install that has never been launched or updated.'
        : '';
  return `This folder has no .build.info file, so it is not a World of Warcraft folder.${hint}`;
}

/** The products listed in a folder's `.build.info`. */
export async function listProducts(source: ByteSource): Promise<BuildInfoEntry[]> {
  const rootNames = await source.list('');
  if (!rootNames.includes('.build.info')) throw new InstallError(notInstallMessage(rootNames));
  return parseBuildInfo(await readText(source, '.build.info'));
}

/** Read-only access to the files of one installed product, by file ID, from the local archives only. */
export class CascStorage {
  private constructor(
    private readonly source: ByteSource,
    readonly info: StorageInfo,
    readonly files: FileIndex,
  ) {}

  static async open(source: ByteSource, options: OpenOptions = {}): Promise<CascStorage> {
    const progress = options.onProgress ?? (() => {});

    progress('config');
    const products = await listProducts(source);
    const entry = options.product
      ? products.find((p) => p.product === options.product)
      : (products.find((p) => p.active) ?? products[0]);
    if (!entry) throw new InstallError('No installed product found in .build.info.');
    const locale = localeFromTags(entry.tags) ?? 'enUS';
    const localeFlag = LOCALE_FLAGS[locale]!;

    let config: Map<string, string[]>;
    try {
      config = parseConfig(await readText(source, configPath(entry.buildKey)));
    } catch {
      throw new InstallError(
        `The build configuration for ${entry.product} ${entry.version} is not on disk. Let Battle.net finish updating the game, then try again.`,
      );
    }
    const rootKey = config.get('root')?.[0];
    const encodingKey = config.get('encoding')?.[1];
    if (!rootKey || !encodingKey) throw new InstallError('The build configuration lists no root or encoding file.');

    const readLocation = async (location: ArchiveLocation): Promise<BlteResult> => {
      const bytes = await source.read(
        archivePath(location.archive),
        location.offset + ARCHIVE_ENTRY_HEADER,
        location.size - ARCHIVE_ENTRY_HEADER,
      );
      return decodeBlte(bytes);
    };

    // The index files are renamed whenever the game updates, so their names plus the build
    // identify the archives' contents.
    const indexNames = currentIndexFiles(await source.list('Data/data'));
    const cacheKey = `files|${entry.buildKey}|${locale}|${indexNames.join(',')}`;
    const stored = await options.cache?.get<StoredIndex>(cacheKey);
    let files: FileIndex;
    if (stored) {
      files = new FileIndex(stored.ids, stored.archives, stored.offsets, stored.sizes, stored.flags, stored.missing, stored.stats);
    } else {
      progress('index');
      const localIndex = await loadLocalIndex(source);

      progress('encoding');
      const encodingLocation = localIndex.find(fromHex(encodingKey));
      if (!encodingLocation) throw new InstallError('The encoding table is not in the local archives.');
      const encoding = new Encoding((await readLocation(encodingLocation)).data);

      progress('root');
      const rootEncodingKey = encoding.find(fromHex(rootKey));
      const rootLocation = rootEncodingKey < 0 ? undefined : localIndex.find(encoding.data, rootEncodingKey);
      if (!rootLocation) throw new InstallError('The root file is not in the local archives.');
      const root = (await readLocation(rootLocation)).data;

      progress('join');
      files = buildFileIndex(root, encoding, localIndex, localeFlag);
      const toStore: StoredIndex = {
        ids: files.ids,
        archives: files.archives,
        offsets: files.offsets,
        sizes: files.sizes,
        flags: files.flags,
        missing: files.missing,
        stats: files.stats,
      };
      await options.cache?.put(cacheKey, toStore);
    }

    const info: StorageInfo = {
      product: entry.product,
      version: entry.version,
      buildName: config.get('build-name')?.[0] ?? '',
      buildKey: entry.buildKey,
      locale,
      fromCache: stored !== undefined,
    };
    return new CascStorage(source, info, files);
  }

  /**
   * Read a file by ID from the local archives. Returns undefined if no copy is on disk.
   * Encrypted chunks come back zero-filled and listed in `encrypted`.
   */
  async readFile(fileId: number): Promise<BlteResult | undefined> {
    const entry = this.files.find(fileId);
    if (!entry) return undefined;
    const bytes = await this.source.read(
      archivePath(entry.archive),
      entry.offset + ARCHIVE_ENTRY_HEADER,
      entry.size - ARCHIVE_ENTRY_HEADER,
    );
    return decodeBlte(bytes);
  }
}
