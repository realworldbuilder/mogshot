/*
 * Plain data with typed arrays in it (a character scene, a picture) as one block of bytes,
 * to hand from Node to the page that draws it: a JSON header in which each typed array is
 * replaced by where its bytes are, then the bytes.
 */

const ARRAYS = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
type ArrayName = keyof typeof ARRAYS;

interface Placed {
  $array: ArrayName;
  at: number;
  length: number;
}

const align = (n: number) => (n + 7) & ~7;

export function pack(value: unknown): Uint8Array {
  const parts: { at: number; bytes: Uint8Array }[] = [];
  let size = 0;
  const json = JSON.stringify(value, (_key, item: unknown) => {
    if (!ArrayBuffer.isView(item)) return item;
    const name = item.constructor.name;
    if (!(name in ARRAYS)) throw new Error(`Cannot pack a ${name}`);
    const array = item as Uint8Array;
    const placed: Placed = { $array: name as ArrayName, at: size, length: array.length };
    parts.push({ at: size, bytes: new Uint8Array(array.buffer, array.byteOffset, array.byteLength) });
    size = align(size + array.byteLength);
    return placed;
  });
  const header = new TextEncoder().encode(json);
  const start = align(4 + header.length);
  const out = new Uint8Array(start + size);
  new DataView(out.buffer).setUint32(0, header.length, true);
  out.set(header, 4);
  for (const part of parts) out.set(part.bytes, start + part.at);
  return out;
}

export function unpack<T>(bytes: Uint8Array): T {
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const start = align(4 + length);
  const json = new TextDecoder().decode(bytes.subarray(4, 4 + length));
  return JSON.parse(json, (_key, item: unknown) => {
    if (typeof item !== 'object' || item === null || !('$array' in item)) return item;
    const placed = item as Placed;
    const Type = ARRAYS[placed.$array];
    const from = bytes.byteOffset + start + placed.at;
    // Copied, so that the array starts on its own boundary whatever the block's offset.
    return new Type((bytes.buffer as ArrayBuffer).slice(from, from + placed.length * Type.BYTES_PER_ELEMENT));
  }) as T;
}
