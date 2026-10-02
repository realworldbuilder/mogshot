import type { Image } from '../formats/blp';

/** A texture to draw into a rectangle of the canvas with one of the game's layer blend modes. */
export interface CompositeLayer {
  image: Image;
  x: number;
  y: number;
  width: number;
  height: number;
  blendMode: number;
}

const BLEND_NONE = 0;
const BLEND_BLIT = 1;
const BLEND_MULTIPLY = 4;
const BLEND_OVERLAY = 6;
const BLEND_SCREEN = 7;

/**
 * Build one texture from layers, bottom first. Each layer is stretched to its rectangle
 * with bilinear filtering. Blend modes: 0 and 1 replace what is there, 4 multiplies,
 * 6 overlays, 7 screens, anything else is ordinary alpha blending.
 */
export function composite(width: number, height: number, layers: readonly CompositeLayer[]): Image {
  const out = new Uint8Array(width * height * 4);
  for (const layer of layers) drawLayer(out, width, height, layer);
  return { width, height, pixels: out };
}

function drawLayer(out: Uint8Array, width: number, height: number, layer: CompositeLayer): void {
  const { image, blendMode } = layer;
  const src = image.pixels;
  const x0 = Math.max(0, Math.round(layer.x));
  const y0 = Math.max(0, Math.round(layer.y));
  const x1 = Math.min(width, Math.round(layer.x + layer.width));
  const y1 = Math.min(height, Math.round(layer.y + layer.height));
  const scaleX = image.width / layer.width;
  const scaleY = image.height / layer.height;

  for (let y = y0; y < y1; y++) {
    // Sample at pixel centres, clamped to the source edges.
    const sy = Math.min(Math.max((y - layer.y + 0.5) * scaleY - 0.5, 0), image.height - 1);
    const syLow = Math.floor(sy);
    const syHigh = Math.min(syLow + 1, image.height - 1);
    const fy = sy - syLow;
    for (let x = x0; x < x1; x++) {
      const sx = Math.min(Math.max((x - layer.x + 0.5) * scaleX - 0.5, 0), image.width - 1);
      const sxLow = Math.floor(sx);
      const sxHigh = Math.min(sxLow + 1, image.width - 1);
      const fx = sx - sxLow;

      const p00 = (syLow * image.width + sxLow) * 4;
      const p10 = (syLow * image.width + sxHigh) * 4;
      const p01 = (syHigh * image.width + sxLow) * 4;
      const p11 = (syHigh * image.width + sxHigh) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const r = src[p00]! * w00 + src[p10]! * w10 + src[p01]! * w01 + src[p11]! * w11;
      const g = src[p00 + 1]! * w00 + src[p10 + 1]! * w10 + src[p01 + 1]! * w01 + src[p11 + 1]! * w11;
      const b = src[p00 + 2]! * w00 + src[p10 + 2]! * w10 + src[p01 + 2]! * w01 + src[p11 + 2]! * w11;
      const a = (src[p00 + 3]! * w00 + src[p10 + 3]! * w10 + src[p01 + 3]! * w01 + src[p11 + 3]! * w11) / 255;

      const d = (y * width + x) * 4;
      if (blendMode === BLEND_NONE || blendMode === BLEND_BLIT) {
        out[d] = r;
        out[d + 1] = g;
        out[d + 2] = b;
        out[d + 3] = a * 255;
        continue;
      }
      const dr = out[d]!;
      const dg = out[d + 1]!;
      const db = out[d + 2]!;
      let mr = r;
      let mg = g;
      let mb = b;
      if (blendMode === BLEND_MULTIPLY) {
        mr = (dr * r) / 255;
        mg = (dg * g) / 255;
        mb = (db * b) / 255;
      } else if (blendMode === BLEND_OVERLAY) {
        mr = r < 127.5 ? (2 * dr * r) / 255 : 255 - (2 * (255 - dr) * (255 - r)) / 255;
        mg = g < 127.5 ? (2 * dg * g) / 255 : 255 - (2 * (255 - dg) * (255 - g)) / 255;
        mb = b < 127.5 ? (2 * db * b) / 255 : 255 - (2 * (255 - db) * (255 - b)) / 255;
      } else if (blendMode === BLEND_SCREEN) {
        mr = 255 - ((255 - dr) * (255 - r)) / 255;
        mg = 255 - ((255 - dg) * (255 - g)) / 255;
        mb = 255 - ((255 - db) * (255 - b)) / 255;
      }
      out[d] = dr + (mr - dr) * a;
      out[d + 1] = dg + (mg - dg) * a;
      out[d + 2] = db + (mb - db) * a;
      out[d + 3] = Math.max(out[d + 3]!, a * 255);
    }
  }
}
