import { describe, expect, it } from 'vitest';
import { alphaBounds, encodePng, unpremultiply } from '../../src/render/export';
import { decodePng } from '../png-decode';

describe('unpremultiply', () => {
  it('restores colour at partial alpha and clears it at zero alpha', () => {
    // 50% red premultiplied; opaque green; transparent with stray colour.
    const pixels = new Uint8Array([128, 0, 0, 128, 0, 255, 0, 255, 9, 9, 9, 0]);
    unpremultiply(pixels);
    expect(Array.from(pixels)).toEqual([255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 0, 0]);
  });

  it('clamps colour brighter than its alpha (additive light)', () => {
    const pixels = new Uint8Array([200, 100, 0, 100]);
    unpremultiply(pixels);
    expect(Array.from(pixels)).toEqual([255, 255, 0, 100]);
  });
});

describe('alphaBounds', () => {
  it('finds the box around non-transparent pixels', () => {
    const pixels = new Uint8Array(5 * 4 * 4);
    pixels[(1 * 5 + 2) * 4 + 3] = 255;
    pixels[(2 * 5 + 3) * 4 + 3] = 1;
    expect(alphaBounds({ width: 5, height: 4, pixels })).toEqual({ x: 2, y: 1, width: 2, height: 2 });
    expect(alphaBounds({ width: 5, height: 4, pixels: new Uint8Array(80) })).toBeUndefined();
  });
});

describe('encodePng', () => {
  it('writes a PNG that decodes to the same straight-alpha pixels', async () => {
    const width = 7;
    const height = 5;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + (i >> 3) * 11) & 0xff;
    const png = await encodePng({ width, height, pixels });
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const decoded = decodePng(png);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(Array.from(decoded.pixels)).toEqual(Array.from(pixels));
  });
});
