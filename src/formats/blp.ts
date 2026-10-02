/*
 * Decoder for BLP2 textures: DXT1/3/5 compressed, palettized, or plain BGRA. Only the
 * largest mip level is decoded. DXT decoding follows wow.export's DXTDecoder (MIT, Kruithne).
 */

export interface Image {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, rows top to bottom, alpha not premultiplied. */
  pixels: Uint8Array;
}

const BLP2 = 0x32504c42;

export function decodeBlp(bytes: Uint8Array): Image {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 148 || dv.getUint32(0, true) !== BLP2) throw new Error('Not a BLP2 texture');
  const encoding = bytes[8]!;
  const alphaDepth = bytes[9]!;
  const alphaEncoding = bytes[10]!;
  const width = dv.getUint32(12, true);
  const height = dv.getUint32(16, true);
  const offset = dv.getUint32(20, true);
  const size = dv.getUint32(84, true);
  const data = bytes.subarray(offset, offset + size);
  const pixels = new Uint8Array(width * height * 4);

  if (encoding === 1) {
    // One palette index per pixel, then alpha at 0, 1, 4 or 8 bits per pixel.
    const palette = 148;
    const count = width * height;
    for (let i = 0; i < count; i++) {
      const entry = palette + data[i]! * 4;
      pixels[i * 4] = bytes[entry + 2]!;
      pixels[i * 4 + 1] = bytes[entry + 1]!;
      pixels[i * 4 + 2] = bytes[entry]!;
      let alpha = 255;
      if (alphaDepth === 1) alpha = (data[count + (i >> 3)]! >> (i & 7)) & 1 ? 255 : 0;
      else if (alphaDepth === 4) alpha = ((data[count + (i >> 1)]! >> ((i & 1) * 4)) & 0xf) * 17;
      else if (alphaDepth === 8) alpha = data[count + i]!;
      pixels[i * 4 + 3] = alpha;
    }
  } else if (encoding === 2) {
    const kind = alphaDepth === 0 || alphaEncoding === 0 ? 'dxt1' : alphaEncoding === 7 ? 'dxt5' : 'dxt3';
    decodeDxt(data, width, height, kind, alphaDepth > 0, pixels);
  } else if (encoding === 3) {
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = data[i * 4 + 2]!;
      pixels[i * 4 + 1] = data[i * 4 + 1]!;
      pixels[i * 4 + 2] = data[i * 4]!;
      pixels[i * 4 + 3] = alphaDepth === 0 ? 255 : data[i * 4 + 3]!;
    }
  } else {
    throw new Error(`Unsupported BLP encoding ${encoding}`);
  }
  return { width, height, pixels };
}

function decodeDxt(
  data: Uint8Array,
  width: number,
  height: number,
  kind: 'dxt1' | 'dxt3' | 'dxt5',
  hasAlpha: boolean,
  out: Uint8Array,
): void {
  const blockBytes = kind === 'dxt1' ? 8 : 16;
  const colors = new Uint8Array(16);
  const alpha = new Uint8Array(16).fill(255);
  const alphaTable = new Uint8Array(8);
  let pos = 0;

  for (let by = 0; by < Math.max(1, (height + 3) >> 2); by++) {
    for (let bx = 0; bx < Math.max(1, (width + 3) >> 2); bx++, pos += blockBytes) {
      const colorAt = kind === 'dxt1' ? pos : pos + 8;
      const c0 = data[colorAt]! | (data[colorAt + 1]! << 8);
      const c1 = data[colorAt + 2]! | (data[colorAt + 3]! << 8);
      for (let i = 0; i < 2; i++) {
        const c = i === 0 ? c0 : c1;
        const r = (c >> 11) & 0x1f;
        const g = (c >> 5) & 0x3f;
        const b = c & 0x1f;
        colors[i * 4] = (r << 3) | (r >> 2);
        colors[i * 4 + 1] = (g << 2) | (g >> 4);
        colors[i * 4 + 2] = (b << 3) | (b >> 2);
        colors[i * 4 + 3] = 255;
      }
      if (kind === 'dxt1' && c0 <= c1) {
        for (let k = 0; k < 3; k++) {
          colors[8 + k] = (colors[k]! + colors[4 + k]!) >> 1;
          colors[12 + k] = 0;
        }
        colors[11] = 255;
        colors[15] = hasAlpha ? 0 : 255;
      } else {
        for (let k = 0; k < 3; k++) {
          colors[8 + k] = (2 * colors[k]! + colors[4 + k]! + 1) / 3;
          colors[12 + k] = (colors[k]! + 2 * colors[4 + k]! + 1) / 3;
        }
        colors[11] = 255;
        colors[15] = 255;
      }

      if (kind === 'dxt3') {
        for (let i = 0; i < 8; i++) {
          const q = data[pos + i]!;
          alpha[i * 2] = (q & 0x0f) * 17;
          alpha[i * 2 + 1] = (q >> 4) * 17;
        }
      } else if (kind === 'dxt5') {
        const a0 = data[pos]!;
        const a1 = data[pos + 1]!;
        alphaTable[0] = a0;
        alphaTable[1] = a1;
        if (a0 > a1) {
          for (let i = 1; i < 7; i++) alphaTable[i + 1] = ((7 - i) * a0 + i * a1) / 7;
        } else {
          for (let i = 1; i < 5; i++) alphaTable[i + 1] = ((5 - i) * a0 + i * a1) / 5;
          alphaTable[6] = 0;
          alphaTable[7] = 255;
        }
        for (let half = 0; half < 2; half++) {
          const at = pos + 2 + half * 3;
          const bits = data[at]! | (data[at + 1]! << 8) | (data[at + 2]! << 16);
          for (let j = 0; j < 8; j++) alpha[half * 8 + j] = alphaTable[(bits >> (3 * j)) & 7]!;
        }
      }

      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= height) break;
        const rowBits = data[colorAt + 4 + py]!;
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          if (x >= width) break;
          const src = ((rowBits >> (px * 2)) & 3) * 4;
          const dst = (y * width + x) * 4;
          out[dst] = colors[src]!;
          out[dst + 1] = colors[src + 1]!;
          out[dst + 2] = colors[src + 2]!;
          out[dst + 3] = kind === 'dxt1' ? colors[src + 3]! : alpha[py * 4 + px]!;
        }
      }
    }
  }
}
