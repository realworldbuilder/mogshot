import { compareBytes, view } from './bytes';

/**
 * The encoding table maps a content key (MD5 of a file's content) to its encoding key
 * (the name it is stored under). Pages are sorted by content key, with an index of each
 * page's first key, so lookups binary-search the page index and scan one page.
 */
export class Encoding {
  private readonly pageCount: number;
  private readonly pageSize: number;
  private readonly indexStart: number;
  private readonly pagesStart: number;

  constructor(private readonly bytes: Uint8Array) {
    const dv = view(bytes);
    if (bytes[0] !== 0x45 || bytes[1] !== 0x4e) throw new Error('Not an encoding table');
    const version = bytes[2];
    const contentKeySize = bytes[3];
    const encodingKeySize = bytes[4];
    if (version !== 1 || contentKeySize !== 16 || encodingKeySize !== 16) {
      throw new Error(`Unsupported encoding table (version ${version}, keys ${contentKeySize}/${encodingKeySize})`);
    }
    this.pageSize = dv.getUint16(5) * 1024;
    this.pageCount = dv.getUint32(9);
    const specSize = dv.getUint32(18);
    this.indexStart = 22 + specSize;
    this.pagesStart = this.indexStart + this.pageCount * 32;
  }

  /**
   * Find the content key at `key[at..at+16]`. Returns the position of its (first)
   * encoding key within `this.data`, or -1.
   */
  find(key: Uint8Array, at = 0): number {
    const { bytes } = this;
    // Last page whose first key is <= key.
    let lo = 0;
    let hi = this.pageCount - 1;
    if (compareBytes(bytes, this.indexStart, key, at, 16) > 0) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (compareBytes(bytes, this.indexStart + mid * 32, key, at, 16) <= 0) lo = mid;
      else hi = mid - 1;
    }
    let p = this.pagesStart + lo * this.pageSize;
    const end = p + this.pageSize;
    // Entry: keyCount u8, file size u40, content key, keyCount encoding keys.
    while (p + 22 <= end) {
      const keyCount = bytes[p]!;
      if (keyCount === 0) break;
      const cmp = compareBytes(bytes, p + 6, key, at, 16);
      if (cmp === 0) return p + 22;
      if (cmp > 0) break;
      p += 22 + keyCount * 16;
    }
    return -1;
  }

  /** The table's bytes; `find` returns positions into this. */
  get data(): Uint8Array {
    return this.bytes;
  }
}
