import { describe, expect, it } from 'vitest';
import { classList, factionOf, playableRaces, raceKey } from '../../src/character/races';

const race = (ID: number, Name_lang: string, ClientFileString: string) => ({ ID, Name_lang, ClientFileString });
const extra = (id: number, alliance: number, order: number) => [id, { alliance, order }] as const;

describe('playableRaces', () => {
  const rows = [race(2, 'Orc', 'Orc'), race(1, 'Human', 'Human'), race(5, 'Undead', 'Scourge'), race(4, 'Night Elf', 'NightElf'), race(99, 'Naga', 'Naga')];
  const creatable = new Set([1, 2, 4, 5]);
  // The Night Elf has only a female model here; the Naga is not creatable.
  const hasModel = (raceId: number, sex: number) => raceId !== 4 || sex === 1;

  it('lists each creatable race with a model on its side of the screen, in the game\'s order', () => {
    const extras = new Map([extra(1, 0, 1), extra(4, 0, 3), extra(2, 1, 1), extra(5, 1, 2)]);
    expect(playableRaces(rows, creatable, hasModel, extras)).toEqual([
      { id: 1, name: 'Human', file: 'Human', sexes: [0, 1], faction: 'alliance', order: 1, key: 'human' },
      { id: 2, name: 'Orc', file: 'Orc', sexes: [0, 1], faction: 'horde', order: 1, key: 'orc' },
      { id: 5, name: 'Undead', file: 'Scourge', sexes: [0, 1], faction: 'horde', order: 2, key: 'undead' },
      { id: 4, name: 'Night Elf', file: 'NightElf', sexes: [1], faction: 'alliance', order: 3, key: 'nightelf' },
    ]);
  });

  it('falls back to name order and an unknown side when the build does not say', () => {
    const races = playableRaces(rows, creatable, hasModel);
    expect(races.map((r) => r.name)).toEqual(['Human', 'Night Elf', 'Orc', 'Undead']);
    expect(races.map((r) => r.order)).toEqual([0, 1, 2, 3]);
    expect(new Set(races.map((r) => r.faction))).toEqual(new Set(['unknown']));
  });

  it('leaves out a race with no model for either sex', () => {
    expect(playableRaces(rows, creatable, () => false)).toEqual([]);
  });
});

describe('factionOf and raceKey', () => {
  it('reads the Alliance column', () => {
    expect([0, 1, 2, 7, undefined].map(factionOf)).toEqual(['alliance', 'horde', 'neutral', 'unknown', 'unknown']);
  });

  it('names the race as the atlas does', () => {
    expect(raceKey('NightElf')).toBe('nightelf');
    expect(raceKey('Scourge')).toBe('undead');
    expect(raceKey('BloodElf')).toBe('bloodelf');
    // Retail's atlas shortens some two-word names and spells the Haranir the old way in the file name.
    expect(raceKey('Harronir')).toBe('haranir');
    expect(raceKey('HighmountainTauren')).toBe('highmountain');
    expect(raceKey('LightforgedDraenei')).toBe('lightforged');
    expect(raceKey('EarthenDwarf')).toBe('earthen');
    expect(raceKey('ZandalariTroll')).toBe('zandalari');
    expect(raceKey('DarkIronDwarf')).toBe('darkirondwarf');
    expect(raceKey('Dracthyr')).toBe('dracthyr');
  });
});

describe('classList', () => {
  const classes = [
    { ID: 8, Name_lang: 'Mage', Filename: 'MAGE' },
    { ID: 1, Name_lang: 'Warrior', Filename: 'WARRIOR' },
    { ID: 6, Name_lang: 'Death Knight', Filename: 'DEATHKNIGHT' },
    { ID: 11, Name_lang: 'Druid', Filename: 'DRUID' },
  ];
  const baseInfo = [
    { ID: 1, RaceID: 1, ClassID: 1 },
    { ID: 2, RaceID: 2, ClassID: 1 },
    { ID: 3, RaceID: 1, ClassID: 8 },
    { ID: 4, RaceID: 4, ClassID: 11 },
    { ID: 5, RaceID: 2, ClassID: 1 }, // repeated
  ];

  it('lists the classes some race can be, in the game\'s order, with their races', () => {
    expect(classList(classes, baseInfo)).toEqual([
      { id: 1, name: 'Warrior', key: 'warrior', races: [1, 2] },
      { id: 8, name: 'Mage', key: 'mage', races: [1] },
      { id: 11, name: 'Druid', key: 'druid', races: [4] },
    ]);
  });

  it('names the class from its name when the build has no file name', () => {
    expect(classList([{ ID: 6, Name_lang: 'Death Knight' }], [{ ID: 1, RaceID: 5, ClassID: 6 }])).toEqual([
      { id: 6, name: 'Death Knight', key: 'deathknight', races: [5] },
    ]);
  });
});
