import { describe, expect, it } from 'vitest';
import { animKeyData } from '../../src/formats/anim';
import { animationId, animationName } from '../../src/model/animation-names';

function chunk(name: string, body: number[]): number[] {
  const size = body.length;
  return [...name].map((c) => c.charCodeAt(0)).concat([size & 0xff, size >> 8, 0, 0], body);
}

describe('animKeyData', () => {
  it('returns a file without chunks whole', () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(animKeyData(raw)).toBe(raw);
  });

  it('returns the single chunk of a chunked file', () => {
    const bytes = new Uint8Array(chunk('AFM2', [7, 8, 9]));
    expect(Array.from(animKeyData(bytes))).toEqual([7, 8, 9]);
  });

  it('prefers the bone chunk when there is one', () => {
    const bytes = new Uint8Array([...chunk('AFM2', [1]), ...chunk('AFSA', [2, 2]), ...chunk('AFSB', [3, 3, 3])]);
    expect(Array.from(animKeyData(bytes))).toEqual([3, 3, 3]);
  });
});

describe('animation names', () => {
  it('names the animations the app relies on', () => {
    expect(animationName(0)).toBe('Stand');
    expect(animationName(15)).toBe('HandsClosed');
    expect(animationId('Ready1H')).toBe(26);
    expect(animationId('EmoteCheer')).toBe(68);
    expect(animationName(999_999)).toBe('Animation 999999');
  });
});
