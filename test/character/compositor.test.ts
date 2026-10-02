import { describe, expect, it } from 'vitest';
import { composite } from '../../src/character/compositor';
import type { Image } from '../../src/formats/blp';

const solid = (width: number, height: number, rgba: number[]): Image => ({
  width,
  height,
  pixels: new Uint8Array(Array.from({ length: width * height }, () => rgba).flat()),
});
const pixel = (image: Image, x: number, y: number) => Array.from(image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

describe('composite', () => {
  const base = { image: solid(2, 2, [200, 100, 50, 255]), x: 0, y: 0, width: 4, height: 4, blendMode: 1 };

  it('stretches a base layer over its rectangle', () => {
    const out = composite(4, 4, [base]);
    expect(pixel(out, 0, 0)).toEqual([200, 100, 50, 255]);
    expect(pixel(out, 3, 3)).toEqual([200, 100, 50, 255]);
  });

  it('draws a layer only inside its rectangle', () => {
    const patch = { image: solid(1, 1, [0, 0, 255, 255]), x: 2, y: 0, width: 2, height: 2, blendMode: 15 };
    const out = composite(4, 4, [base, patch]);
    expect(pixel(out, 2, 1)).toEqual([0, 0, 255, 255]);
    expect(pixel(out, 1, 1)).toEqual([200, 100, 50, 255]);
    expect(pixel(out, 2, 2)).toEqual([200, 100, 50, 255]);
  });

  it('alpha-blends by the layer alpha', () => {
    const half = { image: solid(1, 1, [0, 0, 0, 128]), x: 0, y: 0, width: 4, height: 4, blendMode: 15 };
    const [r, g, b, a] = pixel(composite(4, 4, [base, half]), 0, 0);
    expect(r).toBeCloseTo(100, -1);
    expect(g).toBeCloseTo(50, -1);
    expect(b).toBeCloseTo(25, -1);
    expect(a).toBe(255);
  });

  it('multiplies, overlays and screens', () => {
    const over = (blendMode: number, rgb: number[]) =>
      pixel(composite(4, 4, [base, { image: solid(1, 1, [...rgb, 255]), x: 0, y: 0, width: 4, height: 4, blendMode }]), 0, 0);
    expect(over(4, [128, 128, 128])).toEqual([100, 50, 25, 255]);
    expect(over(7, [255, 0, 0])).toEqual([255, 100, 50, 255]);
    // Overlay with mid-grey leaves the base nearly unchanged.
    const [r, g, b] = over(6, [128, 128, 128]);
    expect(Math.abs(r! - 200) + Math.abs(g! - 100) + Math.abs(b! - 50)).toBeLessThan(6);
  });

  it('replaces alpha with a blit and keeps it otherwise', () => {
    const clear = { image: solid(1, 1, [10, 20, 30, 0]), x: 0, y: 0, width: 4, height: 4, blendMode: 1 };
    expect(pixel(composite(4, 4, [base, clear]), 0, 0)).toEqual([10, 20, 30, 0]);
  });
});
