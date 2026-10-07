import { describe, expect, it } from 'vitest';
import { atlasCells, classPortraitName, crop, racePortraitNames } from '../../src/character/portraits';
import type { Image } from '../../src/formats/blp';

const member = (CommittedName: string, UiTextureAtlasID: number, left: number, top: number, right: number, bottom: number) => ({
  ID: 1,
  CommittedName,
  UiTextureAtlasID,
  CommittedLeft: left,
  CommittedTop: top,
  CommittedRight: right,
  CommittedBottom: bottom,
});
const atlases = [
  { ID: 897, FileDataID: 4000, AtlasWidth: 1024, AtlasHeight: 2048 },
  { ID: 5, FileDataID: 0, AtlasWidth: 64, AtlasHeight: 64 }, // no file
];

describe('atlasCells', () => {
  it('finds the wanted cells by name, without regard to case, and says which are missing', () => {
    const members = [
      member('RaceIcon128-Human-Male', 897, 1, 1, 129, 129),
      member('classicon-warrior', 897, 131, 651, 259, 779),
      member('classicon-druid', 5, 0, 0, 10, 10), // in an atlas with no file
      member('raceicon128-orc-male', 42, 0, 0, 10, 10), // in an atlas the table does not list
    ];
    const { cells, missing } = atlasCells(atlases, members, ['raceicon128-human-male', 'classicon-warrior', 'classicon-druid', 'raceicon128-orc-male']);
    expect([...cells]).toEqual([
      ['raceicon128-human-male', { fileId: 4000, left: 1, top: 1, width: 128, height: 128, atlasWidth: 1024, atlasHeight: 2048 }],
      ['classicon-warrior', { fileId: 4000, left: 131, top: 651, width: 128, height: 128, atlasWidth: 1024, atlasHeight: 2048 }],
    ]);
    expect(missing).toEqual(['classicon-druid', 'raceicon128-orc-male']);
  });

  it('takes a variant of a name that has no cell of its own', () => {
    const members = [member('raceicon-skyborne-male-c60', 897, 0, 0, 64, 64), member('raceicon-skyborne-male-c60-extra', 897, 64, 0, 128, 64)];
    const { cells, missing } = atlasCells(atlases, members, ['raceicon-skyborne-male', 'raceicon-skyborne-female']);
    expect(cells.get('raceicon-skyborne-male')).toMatchObject({ left: 0, width: 64 });
    expect(missing).toEqual(['raceicon-skyborne-female']);
  });
});

describe('crop', () => {
  // A 4 × 4 picture whose pixel at (x, y) is [x, y, 0, 255].
  const image: Image = {
    width: 4,
    height: 4,
    pixels: new Uint8Array(Array.from({ length: 16 }, (_, i) => [i % 4, Math.floor(i / 4), 0, 255]).flat()),
  };
  const pixel = (out: Image, x: number, y: number) => Array.from(out.pixels.subarray((y * out.width + x) * 4, (y * out.width + x) * 4 + 4));

  it('copies the cell', () => {
    const out = crop(image, { fileId: 1, left: 1, top: 2, width: 2, height: 2, atlasWidth: 4, atlasHeight: 4 });
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(pixel(out, 0, 0)).toEqual([1, 2, 0, 255]);
    expect(pixel(out, 1, 1)).toEqual([2, 3, 0, 255]);
  });

  it('keeps a cell that overhangs the picture inside it', () => {
    const out = crop(image, { fileId: 1, left: 3, top: 3, width: 4, height: 4, atlasWidth: 4, atlasHeight: 4 });
    expect([out.width, out.height]).toEqual([1, 1]);
    expect(pixel(out, 0, 0)).toEqual([3, 3, 0, 255]);
  });

  it('scales the cell when the picture is not the size the table says', () => {
    const out = crop(image, { fileId: 1, left: 1, top: 0, width: 1, height: 1, atlasWidth: 2, atlasHeight: 2 });
    expect([out.width, out.height]).toEqual([2, 2]);
    expect(pixel(out, 0, 0)).toEqual([2, 0, 0, 255]);
    expect(pixel(out, 1, 1)).toEqual([3, 1, 0, 255]);
  });
});

describe('portrait names', () => {
  it('are the atlas member names', () => {
    expect(racePortraitNames('nightelf', 1)).toEqual(['raceicon128-nightelf-female', 'raceicon-nightelf-female']);
    expect(racePortraitNames('orc', 0)).toEqual(['raceicon128-orc-male', 'raceicon-orc-male']);
    expect(classPortraitName('deathknight')).toBe('classicon-deathknight');
  });
});
