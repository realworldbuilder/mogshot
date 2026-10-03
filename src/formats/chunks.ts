/** One chunk of a chunked game file: a four-letter name and where its data is. */
export interface Chunk {
  id: string;
  at: number;
  size: number;
}

/** The chunks laid end to end in part of a file. Names are stored backwards. */
export function readChunks(bytes: Uint8Array, from = 0, to = bytes.length): Chunk[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let at = from;
  while (at + 8 <= to) {
    const id = String.fromCharCode(bytes[at + 3]!, bytes[at + 2]!, bytes[at + 1]!, bytes[at]!);
    const size = dv.getUint32(at + 4, true);
    chunks.push({ id, at: at + 8, size });
    at += 8 + size;
  }
  return chunks;
}
