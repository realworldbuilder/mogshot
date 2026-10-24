import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { Appearance } from '../../src/character/appearance';
import { Equipment } from '../../src/character/equipment';
import { buildCharacterScene, type CharacterScene, type PackedRig } from '../../src/character/scene';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import { SEQUENCE_INLINE } from '../../src/formats/m2';
import { animationId } from '../../src/model/animation-names';
import { resolveAlias } from '../../src/model/pose';
import { posableRig } from '../../src/model/posable';
import { cachedFetch } from '../cached-fetch';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

const NAMES = ['Stand', 'Attack1H', 'Attack2H', 'AttackUnarmed', 'CombatWound', 'Walk'];

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('posing a packed character', () => {
  let scene: CharacterScene;
  let built: Awaited<ReturnType<typeof buildCharacterScene>>;
  let packed: PackedRig;

  beforeAll(async () => {
    const storage = await CascStorage.open(new NodeSource(WOW_DIR));
    const definitions = new Definitions(async (url) => {
      const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
      if (text === undefined) throw new Error(`Could not fetch ${url}`);
      return text;
    });
    const database = new Database(storage, definitions);
    const [appearance, equipment] = await Promise.all([Appearance.load(database), Equipment.load(database)]);
    // A sword in hand and a helm on: a mounted mesh for each, and the hand closed around the sword.
    const sword = equipment.search('mainHand', 'sword').items[0];
    const helm = equipment.search('head', 'helm').items[0];
    const gear = new Map<'mainHand' | 'head', number>();
    if (sword) gear.set('mainHand', sword.id);
    if (helm) gear.set('head', helm.id);
    built = await buildCharacterScene(storage, appearance, equipment, { raceId: 1, sex: 0, gear });
    scene = built.scene;
    // Through structured clone, as it crosses from the worker.
    packed = structuredClone(await built.pack(NAMES));
  }, 120_000);

  it('packs one entry per mesh, with keys for the sequences stored outside the model', () => {
    expect(packed.meshes.length).toBe(scene.meshes.length);
    expect(packed.meshes.some((mesh) => mesh.follows === 'attachment')).toBe(true);
    expect(packed.body.md20.byteOffset).toBe(0);
    expect(packed.body.bones.length).toBeGreaterThan(50);
    // Every named sequence whose keys live outside the model has them packed (classic models keep them inline).
    const packedHolders = new Set(packed.anims.map(([sequence]) => sequence));
    for (const name of NAMES) {
      const animation = scene.animations.find((a) => a.id === animationId(name));
      if (!animation) continue;
      const holder = resolveAlias(packed.body.sequences, animation.sequence);
      if ((packed.body.sequences[holder]!.flags & SEQUENCE_INLINE) === 0) expect(packedHolders.has(holder)).toBe(true);
    }
    expect(built.wielding).toBe('oneHand');
  });

  it('poses every named animation as the builder does', async () => {
    const rig = posableRig(packed);
    expect(rig.meshCount).toBe(scene.meshes.length);
    let compared = 0;
    for (const name of NAMES) {
      const animation = scene.animations.find((a) => a.id === animationId(name));
      if (!animation) continue;
      for (const at of [0, 0.37, 1]) {
        const time = at * animation.duration;
        const expected = await built.rig.pose(animation.sequence, time);
        const actual = rig.pose(animation.sequence, time);
        expect(actual.length).toBe(expected.meshes.length);
        actual.forEach((mesh, i) => {
          const want = expected.meshes[i]!;
          expect(mesh.bones.length).toBe(want.bones.length);
          for (let k = 0; k < mesh.bones.length; k++) expect(Math.abs(mesh.bones[k]! - want.bones[k]!)).toBeLessThan(1e-5);
          for (let k = 0; k < 16; k++) expect(Math.abs(mesh.transform[k]! - want.transform[k]!)).toBeLessThan(1e-5);
        });
        compared++;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(6);
    expect(rig.duration(scene.animations.find((a) => a.id === animationId('Walk'))!.sequence)).toBeGreaterThan(0);
  });

  it('finds the right hand in a pose', () => {
    const rig = posableRig(packed);
    const stand = scene.animations.find((a) => a.id === 0)!;
    const body = rig.pose(stand.sequence, 0)[0]!;
    const hand = rig.attachment(body.bones, 1);
    expect(hand).toBeDefined();
    expect(hand![2]).toBeGreaterThan(0.3);
    expect(hand![2]).toBeLessThan(2.2);
  });
});
