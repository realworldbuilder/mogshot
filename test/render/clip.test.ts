import { describe, expect, it } from 'vitest';
import { clipFormatOf } from '../../cli/spec';
import { cameraAt, clipSize, clipTimes, evenSize, loopedTimes, toI420 } from '../../src/render/clip';
import { DEFAULT_CAMERA } from '../../src/render/renderer';

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

  it('moves the camera evenly from one view towards another, arriving the frame after the last', () => {
    const to = { ...DEFAULT_CAMERA, yaw: DEFAULT_CAMERA.yaw + 2 * Math.PI, zoom: 0.5 };
    expect(cameraAt(DEFAULT_CAMERA, to, 0, 60)).toEqual(DEFAULT_CAMERA);
    const half = cameraAt(DEFAULT_CAMERA, to, 30, 60);
    expect(half.yaw).toBeCloseTo(DEFAULT_CAMERA.yaw + Math.PI);
    expect(half.zoom).toBeCloseTo((DEFAULT_CAMERA.zoom + 0.5) / 2);
    expect(half.pitch).toBe(DEFAULT_CAMERA.pitch);
    // A full turn never repeats its first frame, so it loops.
    expect(cameraAt(DEFAULT_CAMERA, to, 59, 60).yaw).toBeLessThan(to.yaw);
  });

  it('runs for about a length by playing the animation a whole number of times', () => {
    // 3.3 s of animation, asked for 10 s: three passes, each the same frames, so the end meets the start.
    const times = loopedTimes(3333, 30, 10);
    expect(times.length).toBe(300);
    expect(times.slice(100, 200)).toEqual(times.slice(0, 100));
    // Never less than one pass.
    expect(loopedTimes(3333, 30, 1).length).toBe(100);
    expect(loopedTimes(0, 30, 10)).toEqual([0]);
  });

  it('turns pixels into standard video levels: black 16, white 235, grey without colour', () => {
    const pixels = new Uint8Array(4 * 2 * 4);
    // Top row white, bottom row black; then a column of pure red.
    pixels.set([255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255], 0);
    pixels.set([0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255], 16);
    const planes = toI420(pixels, 4, 2);
    expect(planes.length).toBe(8 + 2 + 2);
    expect([planes[0], planes[1], planes[4], planes[5]]).toEqual([235, 235, 16, 16]);
    // Half white, half black averages to no colour; red sits at the top of the red-difference plane.
    expect([planes[8], planes[10]]).toEqual([128, 128]);
    expect(planes[2]).toBe(63);
    expect(planes[11]).toBe(240);
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
