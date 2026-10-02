import { describe, expect, it } from 'vitest';
import { decodeBlp } from '../../src/formats/blp';

/** A BLP2 file with one mip level. */
function blp(encoding: number, alphaDepth: number, alphaEncoding: number, width: number, height: number, data: number[], palette: number[] = []): Uint8Array {
  const bytes = new Uint8Array(148 + 1024 + data.length);
  const dv = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4c, 0x50, 0x32]);
  dv.setUint32(4, 1, true);
  bytes.set([encoding, alphaDepth, alphaEncoding, 0], 8);
  dv.setUint32(12, width, true);
  dv.setUint32(16, height, true);
  dv.setUint32(20, 148 + 1024, true);
  dv.setUint32(84, data.length, true);
  bytes.set(palette, 148);
  bytes.set(data, 148 + 1024);
  return bytes;
}

describe('decodeBlp', () => {
  it('decodes plain BGRA', () => {
    const image = decodeBlp(blp(3, 8, 8, 2, 1, [10, 20, 30, 40, 50, 60, 70, 80]));
    expect(Array.from(image.pixels)).toEqual([30, 20, 10, 40, 70, 60, 50, 80]);
  });

  it('decodes palettized pixels with 1-bit alpha', () => {
    // Palette entry 0 = blue, entry 1 = red (stored BGRA); second pixel transparent.
    const image = decodeBlp(blp(1, 1, 0, 2, 1, [1, 0, 0b01], [255, 0, 0, 0, 0, 0, 255, 0]));
    expect(Array.from(image.pixels)).toEqual([255, 0, 0, 255, 0, 0, 255, 0]);
  });

  it('decodes a DXT1 block', () => {
    // c0 = pure red (0xF800), c1 = pure blue (0x001F); c0 > c1 so four opaque colours.
    // Row 0 uses indices 0,1,2,3.
    const image = decodeBlp(blp(2, 0, 0, 4, 4, [0x00, 0xf8, 0x1f, 0x00, 0b11100100, 0, 0, 0]));
    expect(Array.from(image.pixels.subarray(0, 16))).toEqual([
      255, 0, 0, 255,
      0, 0, 255, 255,
      170, 0, 85, 255,
      85, 0, 170, 255,
    ]);
  });

  it('decodes DXT5 alpha', () => {
    // a0 = 255, a1 = 0; alpha index 0 for the first pixel, 1 for the second.
    const alpha = [255, 0, 0b00001000, 0, 0, 0, 0, 0];
    const image = decodeBlp(blp(2, 8, 7, 4, 4, [...alpha, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]));
    expect(image.pixels[3]).toBe(255);
    expect(image.pixels[7]).toBe(0);
    expect(Array.from(image.pixels.subarray(0, 3))).toEqual([255, 255, 255]);
  });

  it('rejects other data', () => {
    expect(() => decodeBlp(new Uint8Array(200))).toThrow('Not a BLP2 texture');
  });
});
