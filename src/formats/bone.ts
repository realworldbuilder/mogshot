/*
 * Reader for .bone files: small adjustments to some of a model's bones, used by appearance
 * choices that reshape the face. Layout follows wowdev.wiki (BONE) and wow.export's
 * BONELoader (MIT, Kruithne and Marlamin).
 */

/** Bone index -> 4x4 matrix (16 floats, column-major) applied to that bone in its own space. */
export type BoneOffsets = Map<number, Float32Array>;

const BIDA = 0x41444942;
const BOMT = 0x544d4f42;

export function parseBoneFile(bytes: Uint8Array): BoneOffsets {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ids: number[] = [];
  const matrices: Float32Array[] = [];
  // A version number, then chunks.
  for (let p = 4; p + 8 <= bytes.length; ) {
    const id = dv.getUint32(p, true);
    const size = dv.getUint32(p + 4, true);
    if (id === BIDA) {
      for (let i = 0; i < size / 2; i++) ids.push(dv.getUint16(p + 8 + i * 2, true));
    } else if (id === BOMT) {
      for (let i = 0; i < size / 64; i++) {
        const matrix = new Float32Array(16);
        for (let k = 0; k < 16; k++) matrix[k] = dv.getFloat32(p + 8 + i * 64 + k * 4, true);
        matrices.push(matrix);
      }
    }
    p += 8 + size;
  }
  const offsets: BoneOffsets = new Map();
  ids.forEach((bone, i) => {
    const matrix = matrices[i];
    if (matrix) offsets.set(bone, matrix);
  });
  return offsets;
}
