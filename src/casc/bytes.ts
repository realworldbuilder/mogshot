const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = '';
  for (let i = start; i < end; i++) out += HEX[bytes[i]!];
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Lexicographic compare of `length` bytes at a[ai..] and b[bi..]. */
export function compareBytes(a: Uint8Array, ai: number, b: Uint8Array, bi: number, length: number): number {
  for (let i = 0; i < length; i++) {
    const d = a[ai + i]! - b[bi + i]!;
    if (d !== 0) return d;
  }
  return 0;
}
