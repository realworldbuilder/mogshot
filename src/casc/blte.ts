import { unzlibSync } from 'fflate';
import { toHex, view } from './bytes';

/** A chunk that was encrypted and could not be decrypted; its bytes are zero in the output. */
export interface EncryptedChunk {
  /** Key name as listed in wowdev/TACTKeys (uppercase hex). */
  keyName: string;
  /** Byte range of the chunk in the decoded output. */
  offset: number;
  length: number;
}

export interface BlteResult {
  data: Uint8Array;
  encrypted: EncryptedChunk[];
}

const MAGIC = 0x424c5445; // 'BLTE'

/**
 * Decode a BLTE container: a list of chunks, each stored raw ('N'), zlib-compressed ('Z')
 * or encrypted ('E'). Encrypted chunks are left as zeros and reported; decryption with
 * known keys is not implemented yet.
 */
export function decodeBlte(input: Uint8Array): BlteResult {
  const dv = view(input);
  if (input.length < 8 || dv.getUint32(0) !== MAGIC) throw new Error('Not a BLTE container');
  const headerSize = dv.getUint32(4);

  const chunks: { start: number; size: number; decodedSize: number }[] = [];
  if (headerSize === 0) {
    // A single chunk of unknown decoded size fills the rest of the input.
    chunks.push({ start: 8, size: input.length - 8, decodedSize: -1 });
  } else {
    const count = dv.getUint32(8) & 0xffffff;
    let start = headerSize;
    for (let i = 0; i < count; i++) {
      const size = dv.getUint32(12 + i * 24);
      const decodedSize = dv.getUint32(16 + i * 24);
      chunks.push({ start, size, decodedSize });
      start += size;
    }
  }

  const encrypted: EncryptedChunk[] = [];
  if (chunks.length === 1 && chunks[0]!.decodedSize < 0) {
    const chunk = chunks[0]!;
    const body = input.subarray(chunk.start + 1, chunk.start + chunk.size);
    const mode = input[chunk.start];
    if (mode === 0x4e) return { data: body.slice(), encrypted };
    if (mode === 0x5a) return { data: unzlibSync(body), encrypted };
    throw new Error(`Unsupported single-chunk BLTE mode ${String.fromCharCode(mode ?? 0)}`);
  }

  let total = 0;
  for (const chunk of chunks) total += chunk.decodedSize;
  const data = new Uint8Array(total);
  let out = 0;
  for (const chunk of chunks) {
    const mode = input[chunk.start];
    const body = input.subarray(chunk.start + 1, chunk.start + chunk.size);
    const target = data.subarray(out, out + chunk.decodedSize);
    if (mode === 0x4e) {
      target.set(body);
    } else if (mode === 0x5a) {
      unzlibSync(body, { out: target });
    } else if (mode === 0x45) {
      // 'E': keyNameSize, keyName (little-endian), ivSize, iv, type, payload.
      const nameSize = body[0]!;
      const name = body.slice(1, 1 + nameSize).reverse();
      encrypted.push({ keyName: toHex(name).toUpperCase(), offset: out, length: chunk.decodedSize });
    } else {
      throw new Error(`Unsupported BLTE chunk mode ${String.fromCharCode(mode ?? 0)}`);
    }
    out += chunk.decodedSize;
  }
  return { data, encrypted };
}
