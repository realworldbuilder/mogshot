import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { Appearance } from '../../src/character/appearance';
import { Equipment } from '../../src/character/equipment';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import type { ImportedRecord } from '../../src/import/record';
import { resolveImport } from '../../src/import/resolve';
import { cachedFetch } from '../cached-fetch';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

const THUNDERFURY = 19019;
const LIONHEART_HELM = 12640;
const HUNTER = 3;
const WARRIOR = 1;

const record = (over: Partial<ImportedRecord> = {}): ImportedRecord => ({
  key: 'Test-Realm',
  name: 'Test',
  realm: 'Realm',
  race: 'Orc',
  sex: 1,
  gear: { head: LIONHEART_HELM, mainHand: THUNDERFURY },
  choices: [],
  captured: 0,
  ...over,
});

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('imported characters', () => {
  let appearance: Appearance;
  let equipment: Equipment;
  let database: Database;

  beforeAll(async () => {
    const storage = await CascStorage.open(new NodeSource(WOW_DIR));
    const definitions = new Definitions(async (url) => {
      const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
      if (text === undefined) throw new Error(`Could not fetch ${url}`);
      return text;
    });
    database = new Database(storage, definitions);
    [appearance, equipment] = await Promise.all([Appearance.load(database), Equipment.load(database)]);
  }, 120_000);

  it('names every creatable race by its file name', () => {
    for (const race of appearance.races) expect(race.file).toMatch(/^[A-Za-z]+$/);
    expect(appearance.races.find((r) => r.name === 'Undead')?.file).toBe('Scourge');
  });

  it('finds the race by id or by file name, and the items by id', () => {
    const byId = resolveImport(record({ raceId: 2 }), appearance, equipment);
    expect(byId.raceId).toBe(2);
    expect(byId.sex).toBe(1);
    expect(byId.gear.map(([slot, item]) => [slot, item.name])).toEqual([
      ['head', 'Lionheart Helm'],
      ['mainHand', 'Thunderfury, Blessed Blade of the Windseeker'],
    ]);
    expect(byId.itemsFound).toEqual({ found: 2, of: 2 });
    expect(byId.problems).toEqual([]);
    const byName = resolveImport(record({ race: 'scourge' }), appearance, equipment);
    expect(appearance.races.find((r) => r.id === byName.raceId)?.name).toBe('Undead');
    expect(() => resolveImport(record({ race: 'Murloc' }), appearance, equipment)).toThrow(/no race called Murloc/);
  });

  it('keeps the appearance choices that belong to the race and sex, and counts the rest', () => {
    const model = appearance.model(2, 1)!;
    const options = appearance.options(model.chrModelId).filter((o) => !o.hidden);
    const own = options[0]!;
    const ownChoice = own.choices.find((c) => c.available)!.id;
    const human = appearance.model(1, 0)!;
    const foreign = appearance.options(human.chrModelId).find((o) => !options.some((own) => own.id === o.id))!;
    const result = resolveImport(
      record({ raceId: 2, choices: [[own.id, ownChoice], [foreign.id, foreign.choices[0]!.id]] }),
      appearance,
      equipment,
    );
    expect(result.choices).toEqual([[own.id, ownChoice]]);
    expect(result.choicesApplied).toEqual({ applied: 1, of: 2 });
    expect(result.problems).toEqual(['1 of 2 captured appearance choices fit Orc female']);
  });

  it('resolves an item id left out of the list as a twin of a listed one', async () => {
    // Find two visible items with the same name, look and slot: the second is not listed.
    const sparse = await database.table('ItemSparse', ['Display_lang', 'InventoryType']);
    const byName = new Map<string, number[]>();
    for (const row of sparse.rows) {
      const key = `${row.Display_lang}:${row.InventoryType}`;
      byName.set(key, [...(byName.get(key) ?? []), Number(row.ID)]);
    }
    let twin: { kept: number; dropped: number } | undefined;
    for (const ids of byName.values()) {
      if (ids.length < 2) continue;
      const listed = ids.filter((id) => equipment.item(id));
      const unlisted = ids.filter((id) => !equipment.item(id) && equipment.resolveItem(id));
      if (listed.length > 0 && unlisted.length > 0) {
        twin = { kept: listed[0]!, dropped: unlisted[0]! };
        break;
      }
    }
    expect(twin).toBeDefined();
    expect(equipment.resolveItem(twin!.dropped)?.id).toBe(twin!.kept);
    expect(equipment.resolveItem(999_999_999)).toBeUndefined();
    const result = resolveImport(record({ gear: { head: 999_999_999 } }), appearance, equipment);
    expect(result.gear).toEqual([]);
    expect(result.itemsFound).toEqual({ found: 0, of: 1 });
    expect(result.problems).toEqual(['Item 999999999 (head) is not in the game data']);
  });

  it('gives a hunter the bow and anyone else their melee weapon', () => {
    const bow = equipment.search('mainHand', 'bow').items.find((i) => i.inventoryType === 15)!;
    const hunter = resolveImport(record({ classId: HUNTER, gear: { mainHand: THUNDERFURY, ranged: bow.id } }), appearance, equipment);
    expect(hunter.gear.map(([slot, item]) => [slot, item.id])).toEqual([['mainHand', bow.id]]);
    expect(hunter.problems).toEqual([`Thunderfury, Blessed Blade of the Windseeker is left out: a hunter is pictured with the ${bow.name}`]);
    const warrior = resolveImport(record({ classId: WARRIOR, gear: { mainHand: THUNDERFURY, ranged: bow.id } }), appearance, equipment);
    expect(warrior.gear.map(([slot, item]) => [slot, item.id])).toEqual([['mainHand', THUNDERFURY]]);
    expect(warrior.problems).toEqual([`${bow.name} is left out: both hands are full`]);
    const unarmed = resolveImport(record({ classId: WARRIOR, gear: { ranged: bow.id } }), appearance, equipment);
    expect(unarmed.gear.map(([slot, item]) => [slot, item.id])).toEqual([['mainHand', bow.id]]);
    expect(unarmed.problems).toEqual([]);
  });

  it('refuses an item that does not fit its slot', () => {
    const result = resolveImport(record({ gear: { head: THUNDERFURY } }), appearance, equipment);
    expect(result.gear).toEqual([]);
    expect(result.problems).toEqual(['Thunderfury, Blessed Blade of the Windseeker does not go in the head slot']);
  });
});
