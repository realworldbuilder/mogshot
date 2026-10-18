import { describe, expect, it } from 'vitest';
import type { M2Model } from '../../src/formats/m2';
import { parseSkel, withSkeleton } from '../../src/formats/skel';

/** A chunk: four-letter tag, size, body. */
function chunk(name: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = name.charCodeAt(i);
  dv.setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** SKB1 with one bone, its pivot at (1, 2, 3), the list right after the 16-byte header. */
function bones(): Uint8Array {
  const body = new Uint8Array(16 + 88);
  const dv = new DataView(body.buffer);
  dv.setUint32(0, 1, true);
  dv.setUint32(4, 16, true);
  dv.setInt32(16, 5, true); // key bone
  dv.setInt16(16 + 8, -1, true); // no parent
  [1, 2, 3].forEach((v, i) => dv.setFloat32(16 + 76 + i * 4, v, true));
  return body;
}

/** SKS1 with no global loops and one Stand sequence. */
function sequences(): Uint8Array {
  const body = new Uint8Array(32 + 64);
  const dv = new DataView(body.buffer);
  dv.setUint32(8, 1, true);
  dv.setUint32(12, 32, true);
  dv.setUint16(32, 0, true);
  dv.setUint32(32 + 4, 1333, true);
  dv.setInt16(32 + 60, -1, true);
  return body;
}

function u32s(...values: number[]): Uint8Array {
  const body = new Uint8Array(values.length * 4);
  values.forEach((v, i) => new DataView(body.buffer).setUint32(i * 4, v, true));
  return body;
}

describe('parseSkel', () => {
  it('reads bones, sequences, anim files and the parent', () => {
    const afid = new Uint8Array(8);
    new DataView(afid.buffer).setUint32(4, 4242, true);
    const skel = parseSkel(join(chunk('SKL1', new Uint8Array(16)), chunk('SKB1', bones()), chunk('SKS1', sequences()), chunk('AFID', afid), chunk('SKPD', u32s(0, 0, 777, 0))));
    expect(skel.bones).toHaveLength(1);
    expect(skel.bones![0]!.keyBoneId).toBe(5);
    expect(skel.bones![0]!.pivot).toEqual([1, 2, 3]);
    expect(skel.sequences!.map((s) => s.duration)).toEqual([1333]);
    expect(skel.animFiles).toEqual([{ sequenceId: 0, variation: 0, fileId: 4242 }]);
    expect(skel.parentFileId).toBe(777);
  });

  it('puts the skeleton into the model, taking anim files from the parent when it has none', () => {
    const child = parseSkel(join(chunk('SKB1', bones()), chunk('SKPD', u32s(0, 0, 777, 0))));
    const parent = parseSkel(join(chunk('SKS1', sequences()), chunk('AFID', u32s(0, 99))));
    const model = { md20: new Uint8Array(4), bones: [], sequences: [], globalSequences: new Uint32Array(0), attachments: [], attachmentLookup: new Int16Array(0), animFiles: [], boneFileIds: [] } as unknown as M2Model;
    const merged = withSkeleton(model, child, parent);
    expect(merged.bones).toHaveLength(1);
    expect(merged.md20.length).toBe(16 + 88);
    expect(merged.sequences).toHaveLength(1);
    expect(merged.animFiles[0]!.fileId).toBe(99);
  });
});
