import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { buildCreatureScene } from '../../src/character/creature-scene';
import { Creatures } from '../../src/character/creatures';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import { cachedFetch } from '../cached-fetch';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';
import { writePng } from '../png';

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('creature scene', () => {
  let storage: CascStorage;
  let creatures: Creatures;

  beforeAll(async () => {
    storage = await CascStorage.open(new NodeSource(WOW_DIR));
    const definitions = new Definitions(async (url) => {
      const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
      if (text === undefined) throw new Error(`Could not fetch ${url}`);
      return text;
    });
    creatures = await Creatures.load(new Database(storage, definitions));
  }, 120_000);

  it('draws the Living Flame from its own model, textured and standing on the ground', async () => {
    const display = creatures.display(1405)!;
    const { scene, rig } = await buildCreatureScene(storage, display);
    scene.textures.forEach((texture, i) => writePng(`test-results/scene/flame-texture-${i}.png`, texture));
    expect(scene.problems).toEqual([]);
    expect(scene.meshes).toHaveLength(1);
    const draws = scene.meshes[0]!.draws;
    expect(draws.length).toBeGreaterThan(0);
    for (const draw of draws) expect(draw.textures.every((t) => t >= 0)).toBe(true);
    expect(scene.options).toEqual([]);
    expect(scene.pose.preset).toBe('Stand');
    expect(scene.presets.map((p) => p.name)).toContain('Stand');
    const height = scene.bounds.max[2] - scene.bounds.min[2];
    expect(height).toBeGreaterThan(0.3);
    expect(height).toBeLessThan(10);
    // Posed again at a later moment of the same animation, the rig answers with the same meshes.
    const later = await rig.pose(scene.pose.sequence, scene.pose.duration / 2);
    expect(later.meshes).toHaveLength(1);
  });

  it('applies the game\'s scale about the feet', async () => {
    const display = creatures.display(7937)!;
    const plain = (await buildCreatureScene(storage, { ...display, scale: 1 })).scene;
    const scaled = (await buildCreatureScene(storage, { ...display, scale: 2 })).scene;
    expect(plain.problems).toEqual([]);
    const height = (scene: typeof plain) => scene.bounds.max[2] - scene.bounds.min[2];
    expect(height(scaled)).toBeCloseTo(height(plain) * 2, 3);
    expect(scaled.bounds.min[2]).toBeCloseTo(plain.bounds.min[2] * 2, 3);
  });
});
