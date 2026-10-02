import { view } from './bytes';

/** Root content flags (merged into one word for root version 2). */
export const ContentFlag = {
  /** A higher-resolution variant of a texture; installed only with the HighRes option. */
  HighRes: 0x1,
  LoadOnWindows: 0x8,
  LoadOnMacOS: 0x10,
  /** Alternate variant of a file that also has a normal one. */
  Alternate: 0x80,
  NoNameHash: 0x10000000,
} as const;

export interface RootBlock {
  localeFlags: number;
  contentFlags: number;
  /** File IDs of the block's records, ascending. */
  fileIds: Int32Array;
  /** Position in the root bytes of record 0's content key; record i's is 16 * i further. */
  keysStart: number;
}

const MFST = 0x4d465354;

/**
 * Walk the root file: blocks of records sharing locale and content flags, each record
 * mapping a file ID to a content key. A file ID can appear in several blocks (one per
 * locale or variant).
 *
 * Handles the `TSFM` formats: 8.2+ (no header size), 10.1.7+ (header size, version 1)
 * and 11.1+ (version 2, split content flags). Only version 2 has been verified against
 * a real install.
 */
export function* readRoot(bytes: Uint8Array): Generator<RootBlock> {
  const dv = view(bytes);
  if (dv.getUint32(0, true) !== MFST) {
    throw new Error('Unsupported root file: this build predates the format Mogshot reads');
  }
  let headerSize = dv.getUint32(4, true);
  let version = dv.getUint32(8, true);
  let totalFiles: number;
  let namedFiles: number;
  if (headerSize !== 0x18) {
    totalFiles = headerSize;
    namedFiles = version;
    version = 0;
    headerSize = 12;
  } else {
    if (version !== 1 && version !== 2) throw new Error(`Unsupported root file version ${version}`);
    totalFiles = dv.getUint32(12, true);
    namedFiles = dv.getUint32(16, true);
  }
  const allowNameless = totalFiles !== namedFiles;

  let p = headerSize;
  while (p < bytes.length) {
    const count = dv.getUint32(p, true);
    let contentFlags: number;
    let localeFlags: number;
    if (version === 2) {
      localeFlags = dv.getUint32(p + 4, true);
      contentFlags = (dv.getUint32(p + 8, true) | dv.getUint32(p + 12, true) | (bytes[p + 16]! << 17)) >>> 0;
      p += 17;
    } else {
      contentFlags = dv.getUint32(p + 4, true);
      localeFlags = dv.getUint32(p + 8, true);
      p += 12;
    }

    const fileIds = new Int32Array(count);
    let next = 0;
    for (let i = 0; i < count; i++) {
      const id = next + dv.getInt32(p + i * 4, true);
      fileIds[i] = id;
      next = id + 1;
    }
    p += count * 4;

    yield { localeFlags, contentFlags, fileIds, keysStart: p };

    p += count * 16;
    if (!(allowNameless && contentFlags & ContentFlag.NoNameHash)) p += count * 8;
  }
}
