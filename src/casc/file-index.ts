import type { Encoding } from './encoding';
import type { ArchiveLocation, LocalIndex } from './local-index';
import { ContentFlag, readRoot } from './root';

export interface FileIndexStats {
  /** File IDs the root lists for this locale. */
  listed: number;
  /** Of those, how many have a copy on disk. */
  onDisk: number;
  /** Textures that have a high-res variant in this build. */
  highResListed: number;
  /** Of those, how many have the high-res variant on disk. */
  highResOnDisk: number;
}

export interface FileEntry extends ArchiveLocation {
  /** The copy on disk is the high-res variant. */
  highRes: boolean;
  /** A high-res variant exists in this build but is not installed. */
  highResMissing: boolean;
}

const FLAG_HIGH_RES = 1;
const FLAG_HIGH_RES_LISTED = 2;

/**
 * File ID -> where to read it on disk, for one locale.
 *
 * The root can list several variants of a file ID. The rule: keep variants whose locale
 * mask includes the install's locale; of those on disk, take the high-res one if present,
 * else the one with the narrowest locale mask, and an alternate only if there is nothing
 * else. A variant that is not on disk is never chosen.
 */
export class FileIndex {
  constructor(
    /** File IDs with a copy on disk, ascending. */
    readonly ids: Uint32Array,
    readonly archives: Uint16Array,
    readonly offsets: Uint32Array,
    readonly sizes: Uint32Array,
    readonly flags: Uint8Array,
    /** File IDs listed for this locale with no copy on disk, ascending. */
    readonly missing: Uint32Array,
    readonly stats: FileIndexStats,
  ) {}

  find(fileId: number): FileEntry | undefined {
    const i = search(this.ids, fileId);
    if (i < 0) return undefined;
    const flags = this.flags[i]!;
    const highRes = (flags & FLAG_HIGH_RES) !== 0;
    return {
      archive: this.archives[i]!,
      offset: this.offsets[i]!,
      size: this.sizes[i]!,
      highRes,
      highResMissing: !highRes && (flags & FLAG_HIGH_RES_LISTED) !== 0,
    };
  }

  /** True if the build lists this file for the locale but it is not installed. */
  isMissing(fileId: number): boolean {
    return search(this.missing, fileId) >= 0;
  }
}

function search(sorted: Uint32Array, value: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = sorted[mid]!;
    if (v === value) return mid;
    if (v < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function bitCount(n: number): number {
  let count = 0;
  for (let v = n >>> 0; v !== 0; v &= v - 1) count++;
  return count;
}

export function buildFileIndex(
  root: Uint8Array,
  encoding: Encoding,
  localIndex: LocalIndex,
  localeFlag: number,
): FileIndex {
  let maxId = 0;
  for (const block of readRoot(root)) {
    const last = block.fileIds[block.fileIds.length - 1];
    if (last !== undefined && last > maxId) maxId = last;
  }

  // Dense per-file-ID state while joining; compacted at the end.
  const size = maxId + 1;
  const SEEN = 1;
  const state = new Uint8Array(size); // SEEN | (FLAG_* << 1)
  const rank = new Uint8Array(size); // 0 = nothing on disk yet; higher is better
  const archives = new Uint16Array(size);
  const offsets = new Uint32Array(size);
  const sizes = new Uint32Array(size);

  for (const block of readRoot(root)) {
    if ((block.localeFlags & localeFlag) === 0) continue;
    const highRes = (block.contentFlags & ContentFlag.HighRes) !== 0;
    // Alternates rank lowest; then narrower locale masks rank higher (2..33); high-res outranks all.
    const blockRank =
      block.contentFlags & ContentFlag.Alternate ? 1 : (highRes ? 64 : 0) + 34 - bitCount(block.localeFlags);
    const ids = block.fileIds;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      state[id]! |= SEEN | (highRes ? FLAG_HIGH_RES_LISTED << 1 : 0);
      if (rank[id]! >= blockRank) continue;
      const encodingKey = encoding.find(root, block.keysStart + i * 16);
      if (encodingKey < 0) continue;
      const location = localIndex.find(encoding.data, encodingKey);
      if (location === undefined) continue;
      rank[id] = blockRank;
      archives[id] = location.archive;
      offsets[id] = location.offset;
      sizes[id] = location.size;
    }
  }

  const stats: FileIndexStats = { listed: 0, onDisk: 0, highResListed: 0, highResOnDisk: 0 };
  for (let id = 0; id < size; id++) {
    if (state[id] === 0) continue;
    stats.listed++;
    if (rank[id]! > 0) stats.onDisk++;
    if ((state[id]! >> 1) & FLAG_HIGH_RES_LISTED) {
      stats.highResListed++;
      if (rank[id]! >= 64) stats.highResOnDisk++;
    }
  }

  const ids = new Uint32Array(stats.onDisk);
  const outArchives = new Uint16Array(stats.onDisk);
  const outOffsets = new Uint32Array(stats.onDisk);
  const outSizes = new Uint32Array(stats.onDisk);
  const outFlags = new Uint8Array(stats.onDisk);
  const missing = new Uint32Array(stats.listed - stats.onDisk);
  let n = 0;
  let m = 0;
  for (let id = 0; id < size; id++) {
    if (state[id] === 0) continue;
    if (rank[id] === 0) {
      missing[m++] = id;
      continue;
    }
    ids[n] = id;
    outArchives[n] = archives[id]!;
    outOffsets[n] = offsets[id]!;
    outSizes[n] = sizes[id]!;
    outFlags[n] = (rank[id]! >= 64 ? FLAG_HIGH_RES : 0) | ((state[id]! >> 1) & FLAG_HIGH_RES_LISTED);
    n++;
  }
  return new FileIndex(ids, outArchives, outOffsets, outSizes, outFlags, missing, stats);
}
