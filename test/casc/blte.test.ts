import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodeBlte } from '../../src/casc/blte';

function blte(chunks: { mode: string; body: Uint8Array; decodedSize: number }[]): Uint8Array {
  const headerSize = 12 + chunks.length * 24;
  const total = headerSize + chunks.reduce((n, c) => n + 1 + c.body.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x42, 0x4c, 0x54, 0x45]);
  dv.setUint32(4, headerSize);
  dv.setUint32(8, (0x0f << 24) | chunks.length);
  let at = headerSize;
  chunks.forEach((chunk, i) => {
    dv.setUint32(12 + i * 24, chunk.body.length + 1);
    dv.setUint32(16 + i * 24, chunk.decodedSize);
    out[at] = chunk.mode.charCodeAt(0);
    out.set(chunk.body, at + 1);
    at += chunk.body.length + 1;
  });
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

describe('decodeBlte', () => {
  it('joins raw and compressed chunks', () => {
    const second = text('compressed '.repeat(50));
    const result = decodeBlte(
      blte([
        { mode: 'N', body: text('raw '), decodedSize: 4 },
        { mode: 'Z', body: zlibSync(second), decodedSize: second.length },
      ]),
    );
    expect(new TextDecoder().decode(result.data)).toBe('raw ' + 'compressed '.repeat(50));
    expect(result.encrypted).toEqual([]);
  });

  it('zero-fills encrypted chunks and reports their key names', () => {
    // keyNameSize 8, key name bytes little-endian, ivSize 4, iv, type 'S', payload
    const body = new Uint8Array([8, 0x65, 0x0a, 0x7a, 0x72, 0x85, 0x77, 0x0e, 0xda, 4, 1, 2, 3, 4, 0x53, 9, 9, 9]);
    const result = decodeBlte(
      blte([
        { mode: 'N', body: text('ab'), decodedSize: 2 },
        { mode: 'E', body, decodedSize: 3 },
      ]),
    );
    expect(Array.from(result.data)).toEqual([0x61, 0x62, 0, 0, 0]);
    expect(result.encrypted).toEqual([{ keyName: 'DA0E7785727A0A65', offset: 2, length: 3 }]);
  });

  it('decodes a headerless single chunk', () => {
    const payload = text('single chunk');
    const z = zlibSync(payload);
    const input = new Uint8Array(8 + 1 + z.length);
    input.set([0x42, 0x4c, 0x54, 0x45, 0, 0, 0, 0, 0x5a]);
    input.set(z, 9);
    expect(new TextDecoder().decode(decodeBlte(input).data)).toBe('single chunk');
  });

  it('rejects data that is not BLTE', () => {
    expect(() => decodeBlte(new Uint8Array(16))).toThrow('Not a BLTE container');
  });
});
