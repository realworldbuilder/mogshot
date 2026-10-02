import type { ByteSource } from '../io/byte-source';
import { view } from './bytes';

/** Where an encoded file sits in the local archives (Data/data/data.NNN). */
export interface ArchiveLocation {
  archive: number;
  offset: number;
  /** Stored size, including the 30-byte archive entry header. */
  size: number;
}

const KEY_BYTES = 9;
const ENTRY_BYTES = 18;

/**
 * The local index: which encoded files are on disk, and where. Built from the
 * Data/data/*.idx files (format version 7: 9-byte key prefix, 5-byte archive/offset
 * with 30 offset bits, 4-byte size).
 */
export class LocalIndex {
  readonly count: number;
  private readonly keys: Uint8Array;
  private readonly archives: Uint16Array;
  private readonly offsets: Uint32Array;
  private readonly sizes: Uint32Array;
  private readonly table: Int32Array;
  private readonly mask: number;

  constructor(files: Uint8Array[]) {
    let capacity = 0;
    const blocks = files.map((file) => {
      const block = entriesBlock(file);
      capacity += block.length / ENTRY_BYTES;
      return block;
    });

    this.keys = new Uint8Array(capacity * KEY_BYTES);
    this.archives = new Uint16Array(capacity);
    this.offsets = new Uint32Array(capacity);
    this.sizes = new Uint32Array(capacity);
    let tableSize = 1024;
    while (tableSize < capacity * 2) tableSize *= 2;
    this.table = new Int32Array(tableSize).fill(-1);
    this.mask = tableSize - 1;

    let n = 0;
    for (const block of blocks) {
      const dv = view(block);
      for (let at = 0; at + ENTRY_BYTES <= block.length; at += ENTRY_BYTES) {
        // The same key can appear twice; the first entry wins.
        if (this.slotOf(block, at) >= 0) continue;
        this.keys.set(block.subarray(at, at + KEY_BYTES), n * KEY_BYTES);
        const high = block[at + 9]!;
        const low = dv.getUint32(at + 10);
        this.archives[n] = (high << 2) | (low >>> 30);
        this.offsets[n] = low & 0x3fffffff;
        this.sizes[n] = dv.getUint32(at + 14, true);
        let slot = this.hash(block, at);
        while (this.table[slot] !== -1) slot = (slot + 1) & this.mask;
        this.table[slot] = n++;
      }
    }
    this.count = n;
  }

  /** Look up an encoding key (only its first 9 bytes are used) at `key[at..]`. */
  find(key: Uint8Array, at = 0): ArchiveLocation | undefined {
    const i = this.slotOf(key, at);
    if (i < 0) return undefined;
    return { archive: this.archives[i]!, offset: this.offsets[i]!, size: this.sizes[i]! };
  }

  private hash(key: Uint8Array, at: number): number {
    return (((key[at]! << 24) | (key[at + 1]! << 16) | (key[at + 2]! << 8) | key[at + 3]!) >>> 0) & this.mask;
  }

  private slotOf(key: Uint8Array, at: number): number {
    let slot = this.hash(key, at);
    for (;;) {
      const i = this.table[slot]!;
      if (i === -1) return -1;
      const k = i * KEY_BYTES;
      let same = true;
      for (let b = 0; b < KEY_BYTES; b++) {
        if (this.keys[k + b] !== key[at + b]) {
          same = false;
          break;
        }
      }
      if (same) return i;
      slot = (slot + 1) & this.mask;
    }
  }
}

/** The entries of one .idx file, after checking it is a layout we understand. */
function entriesBlock(file: Uint8Array): Uint8Array {
  const dv = view(file);
  const headerHashSize = dv.getUint32(0, true);
  const version = dv.getUint16(8, true);
  const sizeBytes = file[12];
  const offsetBytes = file[13];
  const keyBytes = file[14];
  const offsetBits = file[15];
  if (version !== 7 || sizeBytes !== 4 || offsetBytes !== 5 || keyBytes !== 9 || offsetBits !== 30) {
    throw new Error(
      `Unsupported local index layout (version ${version}, fields ${sizeBytes}/${offsetBytes}/${keyBytes}, ${offsetBits} offset bits)`,
    );
  }
  // Header block (8 + headerHashSize) is padded to 16 bytes, then: entries size, entries hash.
  const entriesHeader = (8 + headerHashSize + 15) & ~15;
  const entriesSize = dv.getUint32(entriesHeader, true);
  const start = entriesHeader + 8;
  return file.subarray(start, start + entriesSize);
}

/**
 * Index files are named `BBVVVVVVVV.idx`: bucket (hex) then version (hex).
 * Old versions can linger next to new ones; use the highest version of each bucket.
 */
export function currentIndexFiles(names: string[]): string[] {
  const best = new Map<string, string>();
  for (const name of names) {
    const match = /^([0-9a-f]{2})([0-9a-f]{8})\.idx$/i.exec(name);
    if (!match) continue;
    const bucket = match[1]!.toLowerCase();
    const current = best.get(bucket);
    if (current === undefined || name.toLowerCase() > current.toLowerCase()) best.set(bucket, name);
  }
  return [...best.values()].sort();
}

export async function loadLocalIndex(source: ByteSource): Promise<LocalIndex> {
  const names = currentIndexFiles(await source.list('Data/data'));
  if (names.length === 0) throw new Error('No index files found in Data/data');
  const files = await Promise.all(names.map((name) => source.read(`Data/data/${name}`)));
  return new LocalIndex(files);
}

export function archivePath(archive: number): string {
  return `Data/data/data.${String(archive).padStart(3, '0')}`;
}
