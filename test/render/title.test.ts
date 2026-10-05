import { describe, expect, it } from 'vitest';
import { titleOf } from '../../cli/spec';
import { hasTitle, layTitle, titleMargin, wrapLines } from '../../src/render/title';

describe('a title', () => {
  // Every letter and space ten wide.
  const measure = (line: string) => line.length * 10;

  it('is broken at spaces into lines that fit, keeping line breaks in the text', () => {
    expect(wrapLines('Rambleon the Brave', 120, measure)).toEqual(['Rambleon the', 'Brave']);
    expect(wrapLines('One\nTwo three', 1000, measure)).toEqual(['One', 'Two three']);
    expect(wrapLines('   ', 100, measure)).toEqual([]);
  });

  it('leaves a word wider than a line whole', () => {
    expect(wrapLines('a Supercalifragilistic b', 50, measure)).toEqual(['a', 'Supercalifragilistic', 'b']);
  });

  it('is nothing without words', () => {
    expect(hasTitle(undefined)).toBe(false);
    expect(hasTitle({ text: '  ', at: 'top' })).toBe(false);
    expect(hasTitle({ text: '', sub: 'Level 60', at: 'top' })).toBe(true);
  });

  it('keeps further from the edges of an upright picture, and furthest from its bottom', () => {
    expect(titleMargin(1080, 1920, 'top')).toBeGreaterThan(titleMargin(1920, 1080, 'top'));
    expect(titleMargin(1080, 1920, 'bottom')).toBeGreaterThan(titleMargin(1080, 1920, 'top'));
  });

  it('is laid over the rows it was drawn for, and nowhere else', () => {
    // A picture two wide and three tall, half-transparent red; a title on its middle row.
    const image = { width: 2, height: 3, pixels: new Uint8Array(24) };
    for (let i = 0; i < 24; i += 4) image.pixels.set([128, 0, 0, 128], i);
    const title = { width: 2, height: 1, top: 1, pixels: new Uint8Array([0, 0, 255, 255, 0, 0, 0, 0]) };
    layTitle(image, title);
    expect([...image.pixels.subarray(0, 8)]).toEqual([128, 0, 0, 128, 128, 0, 0, 128]);
    // Solid words cover what is under them; where the title is empty the picture shows.
    expect([...image.pixels.subarray(8, 16)]).toEqual([0, 0, 255, 255, 128, 0, 0, 128]);
    expect([...image.pixels.subarray(16, 24)]).toEqual([128, 0, 0, 128, 128, 0, 0, 128]);
  });

  it('blends soft edges over the picture', () => {
    const image = { width: 1, height: 1, pixels: new Uint8Array([200, 100, 0, 255]) };
    layTitle(image, { width: 1, height: 1, top: 0, pixels: new Uint8Array([64, 64, 64, 128]) });
    expect([...image.pixels]).toEqual([164, 114, 64, 255]);
  });

  it('refuses a picture of another size', () => {
    const image = { width: 2, height: 1, pixels: new Uint8Array(8) };
    expect(() => layTitle(image, { width: 4, height: 1, top: 0, pixels: new Uint8Array(16) })).toThrow(/drawn for a picture 4 wide/);
  });

  it('is given in a spec as words, or as words with a second line and a side', () => {
    expect(titleOf(undefined)).toBeUndefined();
    expect(titleOf('Rambleon')).toEqual({ text: 'Rambleon', at: 'top' });
    expect(titleOf({ text: 'Rambleon', sub: 'Level 60 Warrior', at: 'bottom' })).toEqual({ text: 'Rambleon', sub: 'Level 60 Warrior', at: 'bottom' });
    expect(() => titleOf({ text: 'Rambleon', at: 'middle' as 'top' })).toThrow(/"top" or "bottom"/);
    expect(() => titleOf({ text: '' })).toThrow(/no words/);
  });
});
