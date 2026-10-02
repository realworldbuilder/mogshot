import { describe, expect, it } from 'vitest';
import { describeFile, formatBytes } from '../src/app/describe';

function head(magic: string, fields: [offset: number, value: number][]): Uint8Array {
  const bytes = new Uint8Array(256);
  bytes.set(new TextEncoder().encode(magic));
  const dv = new DataView(bytes.buffer);
  for (const [offset, value] of fields) dv.setUint32(offset, value, true);
  return bytes;
}

describe('describeFile', () => {
  it('describes tables, models and textures', () => {
    expect(describeFile(head('WDC5', [[136, 1234]]))).toBe('database table (WDC5), 1,234 rows');
    expect(describeFile(head('MD21', [[52, 215], [68, 226519]]))).toBe('model (MD21), 226,519 vertices, 215 bones');
    expect(describeFile(head('BLP2', [[12, 256], [16, 128]]))).toBe('texture (BLP2), 256 × 128');
    expect(describeFile(head('\u0000\u0001ab', []))).toBe('unrecognised file (??ab)');
  });
});

describe('formatBytes', () => {
  it('picks a unit', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(20926)).toBe('20.4 KB');
    expect(formatBytes(29702436)).toBe('28.3 MB');
  });
});
