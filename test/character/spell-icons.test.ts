import { describe, expect, it } from 'vitest';
import { chooseSpellIcons } from '../../src/character/spell-icons';

const name = (ID: number, Name_lang: string) => ({ ID, Name_lang });
const misc = (ID: number, SpellID: number, SpellIconFileDataID: number, DifficultyID = 0) => ({ ID, SpellID, DifficultyID, SpellIconFileDataID });

describe('chooseSpellIcons', () => {
  it('takes the lowest-id spell of the name that has an icon, without regard to case', () => {
    const names = [name(116, 'Frostbolt'), name(205, 'frostbolt'), name(837, 'Frostbolt'), name(2136, 'Fire Blast'), name(100, 'Charge')];
    const rows = [misc(1, 116, 0), misc(2, 205, 135846), misc(3, 837, 135846), misc(4, 2136, 135807), misc(5, 100, 132337)];
    expect(chooseSpellIcons(names, rows, ['frostbolt', 'Fire Blast', 'Charge', 'Nothing'])).toEqual([
      { name: 'frostbolt', fileId: 135846, spellId: 205 },
      { name: 'Fire Blast', fileId: 135807, spellId: 2136 },
      { name: 'Charge', fileId: 132337, spellId: 100 },
      { name: 'Nothing', fileId: 0, spellId: 0 },
    ]);
  });

  it('prefers the base difficulty row of a spell with several', () => {
    const names = [name(10, 'Smite')];
    const rows = [misc(1, 10, 1, 5), misc(2, 10, 2, 0), misc(3, 10, 3, 6)];
    expect(chooseSpellIcons(names, rows, ['Smite'])[0]).toEqual({ name: 'Smite', fileId: 2, spellId: 10 });
  });
});
