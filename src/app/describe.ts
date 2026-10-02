/** One-line description of a decoded game file from its first bytes, for the read check. */
export function describeFile(head: Uint8Array): string {
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const magic = String.fromCharCode(...head.subarray(0, 4));
  if (/^WDC\d$/.test(magic) && head.length >= 144) {
    return `database table (${magic}), ${dv.getUint32(136, true).toLocaleString()} rows`;
  }
  if (magic === 'MD21' && head.length >= 76) {
    // MD21 chunk header (8 bytes), then the MD20 model header.
    return `model (MD21), ${dv.getUint32(8 + 60, true).toLocaleString()} vertices, ${dv.getUint32(8 + 44, true)} bones`;
  }
  if (magic === 'BLP2' && head.length >= 20) {
    return `texture (BLP2), ${dv.getUint32(12, true)} × ${dv.getUint32(16, true)}`;
  }
  return `unrecognised file (${magic.replace(/[^\x20-\x7e]/g, '?')})`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
