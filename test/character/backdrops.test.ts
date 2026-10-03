import { describe, expect, it } from 'vitest';
import { loadingScreens } from '../../src/character/backdrops';

const screen = (ID: number, narrow: number, main = 0, wide169 = 0, wide = 0) => ({
  ID,
  NarrowScreenFileDataID: narrow,
  WideScreenFileDataID: wide,
  WideScreen169FileDataID: wide169,
  MainImageFileDataID: main,
});
const map = (ID: number, MapName_lang: string, LoadingScreenID: number) => ({ ID, MapName_lang, LoadingScreenID });

describe('loadingScreens', () => {
  it('names each screen after the maps that show it, continents first, and dedupes shared pictures', () => {
    const screens = [
      screen(186, 131870),
      screen(194, 131870), // the same picture under another row
      screen(23, 131838),
      screen(647, 0, 7963775),
      screen(999, 0), // no picture at all
    ];
    const maps = [
      map(1, 'Kalimdor', 23),
      map(530, 'Outland', 194),
      map(0, 'Eastern Kingdoms', 186),
      map(531, 'Eastern Kingdoms', 186), // repeated name
      map(532, 'Deadwind Pass', 186),
      map(533, 'Caverns of Time', 186),
      map(534, '<unused> Monastery', 186), // developer leftovers are not names
      map(535, 'nothing to see here', 186),
      map(536, 'Test Dungeon', 186),
      map(2, '', 647), // unnamed map does not name the screen
    ];
    expect(loadingScreens(screens, maps)).toEqual([
      { id: 186, fileId: 131870, name: 'Eastern Kingdoms, Outland +2', wide: false },
      { id: 23, fileId: 131838, name: 'Kalimdor', wide: false },
      { id: 647, fileId: 7963775, name: 'Loading screen 647', wide: true },
    ]);
  });

  it('prefers the main picture, then the widescreen ones, over the narrow one', () => {
    expect(loadingScreens([screen(1, 10, 40, 30, 20)], [])[0]).toMatchObject({ fileId: 40, wide: true });
    expect(loadingScreens([screen(1, 10, 0, 30, 20)], [])[0]).toMatchObject({ fileId: 30, wide: true });
    expect(loadingScreens([screen(1, 10, 0, 0, 20)], [])[0]).toMatchObject({ fileId: 20, wide: true });
    expect(loadingScreens([screen(1, 10)], [])[0]).toMatchObject({ fileId: 10, wide: false });
  });
});
