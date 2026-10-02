import type { Image } from '../formats/blp';

/*
 * Turning rendered pixels into a PNG file. The renderer produces colour premultiplied by
 * alpha; a PNG holds straight (unassociated) alpha, which is what Canva, Photoshop and
 * video editors expect. Getting this conversion right is what keeps edges free of dark fringes.
 */

/** Convert premultiplied RGBA to straight alpha, in place. */
export function unpremultiply(pixels: Uint8Array): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3]!;
    if (alpha === 0) {
      // Fully transparent: the colour is never seen. Zero it so nothing leaks when a
      // program resamples the image.
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
    } else if (alpha < 255) {
      const scale = 255 / alpha;
      pixels[i] = Math.min(255, Math.round(pixels[i]! * scale));
      pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1]! * scale));
      pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2]! * scale));
    }
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest rectangle containing every pixel that is not fully transparent, or undefined if there is none. */
export function alphaBounds(image: Image): Rect | undefined {
  const { width, height, pixels } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return undefined;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) c = CRC_TABLE[(c ^ part[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array[] {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, crc32([head.subarray(4), data]));
  return [head, data, tail];
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  // 'deflate' here is the zlib container PNG uses.
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encode straight-alpha RGBA as an 8-bit RGBA PNG. */
export async function encodePng(image: Image): Promise<Uint8Array> {
  const { width, height, pixels } = image;
  const stride = width * 4;
  // Each row is stored as the difference from the row above ("Up" filter), which compresses well.
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const out = y * (stride + 1);
    const row = y * stride;
    if (y === 0) {
      raw[out] = 0;
      raw.set(pixels.subarray(0, stride), out + 1);
    } else {
      raw[out] = 2;
      for (let i = 0; i < stride; i++) raw[out + 1 + i] = pixels[row + i]! - pixels[row - stride + i]!;
    }
  }

  const header = new Uint8Array(13);
  const dv = new DataView(header.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ...chunk('IHDR', header),
    ...chunk('IDAT', await deflate(raw)),
    ...chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
