/*
 * Reader for .anim files: the animation keys of one sequence, stored outside the model.
 * A file is either the raw key data or chunks: AFM2 (keys for a model with its own
 * skeleton), AFSA and AFSB (attachment and bone keys for a separate skeleton file).
 * Layout follows wowdev.wiki (M2#.anim_files) and wow.export's ANIMLoader (MIT).
 */

const tag = (name: string) =>
  name.charCodeAt(0) | (name.charCodeAt(1) << 8) | (name.charCodeAt(2) << 16) | (name.charCodeAt(3) << 24);

const AFM2 = tag('AFM2');
const AFSA = tag('AFSA');
const AFSB = tag('AFSB');

/** The bytes that bone tracks' key offsets point into: the bone chunk if present, else the single chunk, else the whole file. */
export function animKeyData(bytes: Uint8Array): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const first = bytes.length >= 8 ? dv.getUint32(0, true) : 0;
  if (first !== AFM2 && first !== AFSA && first !== AFSB) return bytes;
  let single: Uint8Array | undefined;
  for (let p = 0; p + 8 <= bytes.length; ) {
    const id = dv.getUint32(p, true);
    const size = dv.getUint32(p + 4, true);
    const body = bytes.subarray(p + 8, p + 8 + size);
    if (id === AFSB) return body;
    if (id === AFM2) single = body;
    p += 8 + size;
  }
  return single ?? bytes;
}
