import { describe, expect, it } from 'vitest';
import { clipFormatOf } from '../../cli/spec';
import { clipSize, clipTimes, evenSize } from '../../src/render/clip';

describe('a clip', () => {
  it('is one pass of the animation, ending a frame before it begins again', () => {
    const times = clipTimes(2000, 30);
    expect(times.length).toBe(60);
    expect(times[0]).toBe(0);
    // The frame after the last would be at 2000: the start again.
    expect(times[59]! + times[1]!).toBeCloseTo(2000);
    // A length that is not a whole number of frames is spread evenly rather than cut short.
    const odd = clipTimes(3333, 30);
    expect(odd.length).toBe(100);
    expect(odd[99]! + odd[1]!).toBeCloseTo(3333);
  });

  it('goes round the animation again when it is longer', () => {
    const times = clipTimes(1000, 10, 2.5);
    expect(times.length).toBe(25);
    expect(times[9]).toBeCloseTo(900);
    expect(times[10]).toBeCloseTo(0);
    expect(times[24]).toBeCloseTo(400);
    for (const time of times) expect(time).toBeLessThan(1000);
  });

  it('has one frame for an animation with no length', () => {
    expect(clipTimes(0, 30)).toEqual([0]);
  });

  it('keeps the picture shape at video size, with even sides', () => {
    expect(clipSize({ width: 2160, height: 2160 })).toEqual({ width: 1080, height: 1080 });
    expect(clipSize({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 });
    expect(clipSize({ width: 2160, height: 3840 })).toEqual({ width: 1080, height: 1920 });
    expect(clipSize({ width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 });
    expect(clipSize({ width: 2160, height: 2160 }, true)).toEqual({ width: 800, height: 800 });
    expect(evenSize(401, 333)).toEqual({ width: 402, height: 334 });
  });

  it('takes its kind from the file name', () => {
    expect(clipFormatOf('a/dance.MP4')).toBe('mp4');
    expect(clipFormatOf('dance.gif')).toBe('gif');
    expect(clipFormatOf('dance.zip')).toBe('frames');
    expect(clipFormatOf('dance.png')).toBeUndefined();
    expect(clipFormatOf(undefined)).toBeUndefined();
  });
});
