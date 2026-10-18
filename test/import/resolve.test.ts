import { describe, expect, it } from 'vitest';
import type { Appearance } from '../../src/character/appearance';
import type { Equipment, ItemSummary } from '../../src/character/equipment';
import { decodeRecord } from '../../src/import/record';
import { resolveImport } from '../../src/import/resolve';

// Just enough game data for a retail Void Elf: one model with one option, and the items
// and appearance sources the code below names.
const appearance = {
  races: [{ id: 29, name: 'Void Elf', file: 'VoidElf', sexes: [0, 1] }],
  model: () => ({ chrModelId: 70 }),
  options: () => [{ id: 470, choices: [{ id: 11000 }, { id: 11001 }] }],
} as unknown as Appearance;

const item = (id: number, inventoryType: number, name = `Item ${id}`): ItemSummary => ({ id, name, quality: 4, inventoryType, iconFileId: 0 });
const ITEMS = new Map([
  [212003, item(212003, 5, 'Robe as worn')],
  [212005, item(212005, 7, 'Leggings as worn')],
  [207790, item(207790, 17, 'Staff as worn')],
  [99001, item(99001, 20, 'Robe of the transmog')],
  [99002, item(99002, 17)],
]);
const SOURCES = new Map([
  [77344, { itemId: 134110, displayId: 0 }], // hidden helm
  [201500, { itemId: 99001, displayId: 5550 }],
  [190007, { itemId: 212005, displayId: 6660 }],
  [140000, { itemId: 99002, displayId: 7770 }],
]);
const equipment = {
  resolveItem: (id: number) => ITEMS.get(id),
  source: (id: number) => SOURCES.get(id),
} as unknown as Equipment;

describe('a retail character', () => {
  it('wears the look each slot shows, in that colour, and leaves hidden slots empty', () => {
    const record = decodeRecord('MOG2;Elowyn-Area 52;29;1;8;H4jkwC4jkzP4jl1M4gby;8hl.8iy;H1nogC4bh8P42lzM300w')!;
    record.items = { 99002: { name: 'Staff of the transmog', quality: 3 } };
    const result = resolveImport(record, appearance, equipment);
    expect(result.raceId).toBe(29);
    expect(result.sex).toBe(1);
    expect(result.classId).toBe(8);
    // 11050 belongs to no option of this model.
    expect(result.choices).toEqual([[470, 11001]]);
    expect(result.gear).toEqual([
      ['chest', { ...ITEMS.get(99001), displayId: 5550 }],
      ['legs', { ...ITEMS.get(212005), displayId: 6660 }],
      ['mainHand', { ...ITEMS.get(99002), name: 'Staff of the transmog', quality: 3, displayId: 7770 }],
    ]);
    expect(result.notes).toEqual(['The head slot is left empty: the character hides it']);
    expect(result.itemsFound).toEqual({ found: 4, of: 4 });
    expect(result.problems).toEqual(['1 of 2 captured appearance choices fit Void Elf female']);
  });

  it('draws the worn item where a source is not in the game data, and the items alone without sources', () => {
    const unknown = decodeRecord('MOG2;Elowyn-Area 52;29;1;8;C4jkz;;C1')!;
    const result = resolveImport(unknown, appearance, equipment);
    expect(result.gear).toEqual([['chest', ITEMS.get(212003)]]);
    expect(result.problems).toEqual(['Appearance 1 (chest) is not in the game data, so the worn item is drawn']);
    const classic = resolveImport(decodeRecord('MOG2;Elowyn-Area 52;29;1;8;C4jkzP4jl1;')!, appearance, equipment);
    expect(classic.gear).toEqual([['chest', ITEMS.get(212003)], ['legs', ITEMS.get(212005)]]);
  });
});
