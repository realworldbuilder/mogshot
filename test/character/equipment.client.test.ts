import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { Appearance } from '../../src/character/appearance';
import { Equipment, SLOTS, type Slot } from '../../src/character/equipment';
import { buildCharacterScene } from '../../src/character/scene';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import { cachedFetch } from '../cached-fetch';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

/** Build a character and return just the scene. */
const buildScene = async (...args: Parameters<typeof buildCharacterScene>) => (await buildCharacterScene(...args)).scene;

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('gear', () => {
  let storage: CascStorage;
  let appearance: Appearance;
  let equipment: Equipment;

  beforeAll(async () => {
    storage = await CascStorage.open(new NodeSource(WOW_DIR));
    const definitions = new Definitions(async (url) => {
      const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
      if (text === undefined) throw new Error(`Could not fetch ${url}`);
      return text;
    });
    const database = new Database(storage, definitions);
    [appearance, equipment] = await Promise.all([Appearance.load(database), Equipment.load(database)]);
  }, 120_000);

  const find = (slot: Slot, name: string) => {
    const item = equipment.search(slot, name).items.find((i) => i.name === name);
    if (!item) throw new Error(`No item named ${name} for ${slot}`);
    return item;
  };

  it('lists items for every slot', () => {
    for (const slot of SLOTS) {
      const { items, total } = equipment.search(slot.id, '');
      console.log(`${slot.name}: ${total} items`);
      expect(total).toBeGreaterThan(10);
      expect(items.length).toBeLessThanOrEqual(60);
      for (const item of items) expect(slot.inventoryTypes).toContain(item.inventoryType);
    }
  });

  it('finds items by name, whole-name matches first', () => {
    const { items } = equipment.search('mainHand', 'thunderfury');
    expect(items[0]?.name).toBe('Thunderfury, Blessed Blade of the Windseeker');
    expect(items[0]?.iconFileId).toBeGreaterThan(0);
    expect(equipment.search('head', 'helm lionheart').items.map((i) => i.name)).toContain('Lionheart Helm');
    expect(equipment.search('head', 'zzzz no such item').total).toBe(0);
  });

  it('picks the helm model made for the race and sex', () => {
    const helm = find('head', 'Lionheart Helm');
    const humanMale = equipment.look(helm.id, 'head', 1, 0)!;
    const humanFemale = equipment.look(helm.id, 'head', 1, 1)!;
    const orcMale = equipment.look(helm.id, 'head', 2, 0)!;
    expect(humanMale.models).toHaveLength(1);
    const files = new Set([humanMale, humanFemale, orcMale].map((look) => look.models[0]!.fileId));
    expect(files.size).toBe(3);
    expect(humanMale.models[0]!.textures.get(2)).toBeGreaterThan(0);
    expect(humanMale.hideGroups.length).toBeGreaterThan(0);
  });

  it('dresses a human male with nothing missing', async () => {
    const gear = new Map<Slot, number>([
      ['head', find('head', 'Lionheart Helm').id],
      ['shirt', find('shirt', "Recruit's Shirt").id],
      ['chest', find('chest', 'Robe of the Archmage').id],
      ['mainHand', find('mainHand', 'Thunderfury, Blessed Blade of the Windseeker').id],
    ]);
    const bare = await buildScene(storage, appearance, equipment, { raceId: 1, sex: 0 });
    const dressed = await buildScene(storage, appearance, equipment, { raceId: 1, sex: 0, gear });
    expect(dressed.problems).toEqual([]);
    // The body, the helm and the sword.
    expect(dressed.meshes).toHaveLength(3);
    for (const mesh of dressed.meshes) {
      expect(mesh.draws.length).toBeGreaterThan(0);
      for (const draw of mesh.draws) expect(draw.textures.every((t) => t >= 0)).toBe(true);
    }
    // The robe's skirt replaces the bare legs geoset, and its cloth is painted on the body texture.
    const sections = (scene: typeof bare) => scene.meshes[0]!.draws.map((d) => d.sectionId);
    expect(sections(bare)).toContain(1301);
    expect(sections(dressed)).toContain(1302);
    expect(sections(dressed)).not.toContain(1301);
    expect(dressed.textures[0]!.pixels).not.toEqual(bare.textures[0]!.pixels);
    // The sword reaches beyond the bare body.
    expect(dressed.bounds.max[0] - dressed.bounds.min[0]).toBeGreaterThan(bare.bounds.max[0] - bare.bounds.min[0]);
  });

  it('hides boot tops and trouser legs under a robe', async () => {
    const boots = find('feet', 'Dreadnaught Sabatons').id;
    const legs = find('legs', 'Dreadnaught Legplates').id;
    const robe = find('chest', 'Frostfire Robe').id;
    const sections = async (gear: [Slot, number][]) => {
      const scene = await buildScene(storage, appearance, equipment, { raceId: 1, sex: 0, gear: new Map(gear) });
      expect(scene.problems).toEqual([]);
      return scene.meshes[0]!.draws.map((d) => d.sectionId);
    };
    const armoured = await sections([['feet', boots], ['legs', legs]]);
    const robed = await sections([['feet', boots], ['legs', legs], ['chest', robe]]);
    // The plate boots have a boot-top geoset; under the robe the plain foot is drawn instead.
    expect(armoured.some((id) => id > 501 && id < 600)).toBe(true);
    expect(robed.filter((id) => id >= 500 && id < 600)).toEqual([501]);
    expect(robed).toContain(1302);
  });

  it('names the item when something of it cannot be found', async () => {
    const scene = await buildScene(storage, appearance, equipment, {
      raceId: 1,
      sex: 0,
      gear: new Map<Slot, number>([['head', 999_999_999]]),
    });
    expect(scene.problems).toEqual(['Item 999999999 is not in the game data']);
  });

  it('has the files of nearly every item on disk, for every race and sex', () => {
    let items = 0;
    const missing = new Map<number, string>();
    for (const slot of SLOTS) {
      for (const item of equipment.search(slot.id, '', 100_000).items) {
        items++;
        for (const race of appearance.races) {
          for (const sex of race.sexes) {
            const look = equipment.look(item.id, slot.id, race.id, sex)!;
            const files = [
              ...look.bodyTextures.map((t) => t.fileId),
              ...look.models.flatMap((m) => [m.fileId, ...m.textures.values()]),
              ...look.characterTextures.values(),
            ];
            for (const file of files) if (!storage.files.find(file)) missing.set(file, item.name);
          }
        }
        if (item.iconFileId && !storage.files.find(item.iconFileId)) missing.set(item.iconFileId, `${item.name} (icon)`);
      }
    }
    console.log(`${items} items checked; ${missing.size} files not on disk`, [...missing].slice(0, 12));
    expect(items).toBeGreaterThan(5000);
    expect(missing.size).toBeLessThan(items * 0.01);
  });

  it('builds a spread of items on several races with every surface textured', async () => {
    const combos = [[1, 0], [1, 1], [6, 0], [7, 1], [8, 0], [5, 1]] as const;
    const reported: string[] = [];
    let built = 0;
    for (const slot of SLOTS) {
      const all = equipment.search(slot.id, '', 100_000).items;
      // Every 25th item of the slot.
      for (let i = 0; i < all.length; i += 25) {
        const item = all[i]!;
        const [raceId, sex] = combos[built % combos.length]!;
        const scene = await buildScene(storage, appearance, equipment, { raceId, sex, gear: new Map([[slot.id, item.id]]) });
        built++;
        const untextured = scene.meshes.flatMap((mesh) => mesh.draws).filter((draw) => draw.textures.some((t) => t < 0));
        // Anything unreadable must have been reported; nothing may be silently untextured.
        if (untextured.length > 0 && scene.problems.length === 0) {
          reported.push(`${item.name} (${slot.name}, race ${raceId} sex ${sex}): untextured geosets ${untextured.map((d) => d.sectionId)}`);
        }
        for (const problem of scene.problems) reported.push(`${item.name} (${slot.name}, race ${raceId} sex ${sex}): ${problem}`);
      }
    }
    console.log(`${built} single-item scenes built; ${reported.length} with something reported`, reported.slice(0, 20));
    expect(reported.filter((line) => line.includes('untextured geosets'))).toEqual([]);
    expect(reported.length).toBeLessThan(built * 0.02);
  }, 300_000);
});
