import { describe, expect, it } from 'vitest';
import { classicArt, coverFit, GRADIENTS, overBlack, slug, trimDark } from '../../src/render/backdrop';

describe('coverFit', () => {
  it('keeps the whole source when the shapes match', () => {
    expect(coverFit(1024, 768, 2048, 1536)).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
  });

  it('crops the top and bottom of a 4:3 picture to fill a 16:9 frame', () => {
    const crop = coverFit(1024, 768, 3840, 2160);
    expect(crop.width).toBe(1024);
    expect(crop.height).toBe(576);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(96);
  });

  it('crops the sides of a wide picture to fill a tall frame', () => {
    const crop = coverFit(2048, 1024, 2880, 3840);
    expect(crop.height).toBe(1024);
    expect(crop.width).toBe(768);
    expect(crop.y).toBe(0);
    expect(crop.x).toBe(640);
  });
});

describe('gradient palette', () => {
  it('uses colours a colour input accepts, with distinct names', () => {
    for (const g of GRADIENTS) {
      expect(g.from).toMatch(/^#[0-9a-f]{6}$/);
      expect(g.to).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(new Set(GRADIENTS.map((g) => g.name)).size).toBe(GRADIENTS.length);
  });
});

describe('slug', () => {
  it('makes a file-name-safe word', () => {
    expect(slug('Eastern Kingdoms, Outland')).toBe('eastern-kingdoms-outland');
    expect(slug("Blackfathom Deeps' End")).toBe('blackfathom-deeps-end');
  });
});

describe('trimDark', () => {
  const picture = (width: number, height: number, lit: (x: number, y: number) => boolean) => {
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = lit(x, y) ? 120 : 8;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
        pixels[i + 3] = 255;
      }
    }
    return { width, height, pixels };
  };

  it('cuts letterbox bars off the top and bottom', () => {
    expect(trimDark(picture(300, 170, (_x, y) => y >= 20 && y < 150))).toEqual({ x: 0, y: 20, width: 300, height: 130 });
  });

  it('cuts pillarbox bars off the sides', () => {
    expect(trimDark(picture(300, 170, (x) => x >= 30 && x < 270))).toEqual({ x: 30, y: 0, width: 240, height: 170 });
  });

  it('keeps a picture with no bars, and an all-dark one, whole', () => {
    expect(trimDark(picture(64, 48, () => true))).toEqual({ x: 0, y: 0, width: 64, height: 48 });
    expect(trimDark(picture(64, 48, () => false))).toEqual({ x: 0, y: 0, width: 64, height: 48 });
  });
});

describe('overBlack', () => {
  it('turns transparent bars black and keeps the picture, so the trim finds the picture', () => {
    const width = 40;
    const height = 30;
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        pixels[i] = 148;
        pixels[i + 1] = 150;
        pixels[i + 2] = 148;
        pixels[i + 3] = y >= 5 && y < 25 ? 255 : 12; // transparent bars, with the noise a compressed alpha has
      }
    }
    const flat = overBlack({ width, height, pixels });
    expect([...flat.pixels.subarray(0, 4)]).toEqual([7, 7, 7, 255]);
    expect([...flat.pixels.subarray(10 * width * 4, 10 * width * 4 + 4)]).toEqual([148, 150, 148, 255]);
    expect(trimDark(flat)).toEqual({ x: 0, y: 5, width, height: 20 });
  });
});

describe('classicArt', () => {
  it('is the band below the logo, full width', () => {
    expect(classicArt({ width: 512, height: 512, pixels: new Uint8Array(0) })).toEqual({ x: 0, y: 118, width: 512, height: 302 });
  });
});
