import { unzlibSync } from 'fflate';
import type { Image } from '../src/formats/blp';

/** Decode an 8-bit RGBA PNG (all five row filters), for checking exported files in tests. */
export function decodePng(bytes: Uint8Array): Image {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  const data: Uint8Array[] = [];
  for (let p = 8; p < bytes.length; ) {
    const length = dv.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const body = bytes.subarray(p + 8, p + 8 + length);
    if (type === 'IHDR') {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      if (body[8] !== 8 || body[9] !== 6) throw new Error('Only 8-bit RGBA PNGs are supported');
    } else if (type === 'IDAT') data.push(body);
    p += 12 + length;
  }
  const joined = new Uint8Array(data.reduce((n, d) => n + d.length, 0));
  let at = 0;
  for (const d of data) {
    joined.set(d, at);
    at += d.length;
  }
  const raw = unzlibSync(joined);
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = y * (stride + 1) + 1;
    const out = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? pixels[out + i - 4]! : 0;
      const up = y > 0 ? pixels[out - stride + i]! : 0;
      const upLeft = y > 0 && i >= 4 ? pixels[out - stride + i - 4]! : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[out + i] = (raw[row + i]! + predicted) & 0xff;
    }
  }
  return { width, height, pixels };
}

/** Composite a straight-alpha image over a solid colour. */
export function over(image: Image, background: [number, number, number]): Image {
  const pixels = new Uint8Array(image.pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const a = image.pixels[i + 3]! / 255;
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(image.pixels[i + c]! * a + background[c]! * (1 - a));
    pixels[i + 3] = 255;
  }
  return { width: image.width, height: image.height, pixels };
}
