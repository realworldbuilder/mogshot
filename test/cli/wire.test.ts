import { describe, expect, it } from 'vitest';
import { pack, unpack } from '../../cli/wire';

describe('wire', () => {
  it('carries typed arrays inside plain data, each as its own kind', () => {
    const value = {
      name: 'scene',
      meshes: [{ indices: new Uint16Array([1, 2, 3]), bones: new Float32Array([0.5, -1.25]), vertices: new Uint8Array([9, 8, 7, 6, 5]) }],
      empty: new Uint32Array(0),
      nested: { list: [1, 'two', null], flag: true },
    };
    const back = unpack<typeof value>(pack(value));
    expect(back).toEqual(value);
    expect(back.meshes[0]!.bones).toBeInstanceOf(Float32Array);
    expect(back.meshes[0]!.indices).toBeInstanceOf(Uint16Array);
  });

  it('reads a block that sits at an odd offset in its buffer, and views of part of a buffer', () => {
    const whole = new Float32Array([1, 2, 3, 4]);
    const packed = pack({ part: whole.subarray(1, 3) });
    const shifted = new Uint8Array(packed.length + 3);
    shifted.set(packed, 3);
    expect(unpack<{ part: Float32Array }>(shifted.subarray(3)).part).toEqual(new Float32Array([2, 3]));
  });
});
