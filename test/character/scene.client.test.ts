import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { Appearance } from '../../src/character/appearance';
import { buildCharacterScene, type CharacterScene } from '../../src/character/scene';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import { cachedFetch } from '../cached-fetch';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';
import { writePng } from '../png';

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('human male scene', () => {
  let appearance: Appearance;
  let scene: CharacterScene;

  beforeAll(async () => {
    const storage = await CascStorage.open(new NodeSource(WOW_DIR));
    const definitions = new Definitions(async (url) => {
      const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
      if (text === undefined) throw new Error(`Could not fetch ${url}`);
      return text;
    });
    appearance = await Appearance.load(new Database(storage, definitions));
    scene = await buildCharacterScene(storage, appearance, { raceId: 1, sex: 0 });
    // Kept for looking at by eye; test-results/ is not committed.
    scene.textures.forEach((texture, i) => writePng(`test-results/scene/texture-${i}.png`, texture));
  }, 120_000);

  it('offers the human male options with available choices', () => {
    const model = appearance.model(1, 0)!;
    const options = appearance.options(model.chrModelId);
    expect(options.map((o) => o.name)).toEqual(expect.arrayContaining(['Skin Color', 'Face', 'Hair Style', 'Hair Color']));
    for (const option of options) expect(option.choices.some((c) => c.available)).toBe(true);
    expect(appearance.defaultChoices(model.chrModelId).size).toBe(options.length);
  });

  it('draws the body with every stage textured', () => {
    console.log('draws', scene.draws.map((d) => `${d.sectionId}:${d.shaderId}/${d.blendMode}/[${d.textures}]`).join(' '));
    console.log('textures', scene.textures.map((t) => `${t.width}x${t.height}`).join(' '), 'problems', scene.problems);
    expect(scene.draws.some((d) => d.sectionId === 0)).toBe(true);
    for (const draw of scene.draws) expect(draw.textures.every((t) => t >= 0)).toBe(true);
  });

  it('reports only the known gap', () => {
    expect(scene.problems.filter((p) => !p.startsWith('Face shape: bone sets'))).toEqual([]);
  });

  it('stands about two units tall on the ground', () => {
    const { min, max } = scene.bounds;
    expect(max[2] - min[2]).toBeGreaterThan(1.6);
    expect(max[2] - min[2]).toBeLessThan(2.6);
    expect(Math.abs(min[2])).toBeLessThan(0.1);
  });

  it('indexes only vertices it carries', () => {
    const count = scene.vertices.length / 48;
    for (const draw of scene.draws) {
      for (let i = draw.indexStart; i < draw.indexStart + draw.indexCount; i++) expect(scene.indices[i]).toBeLessThan(count);
    }
  });
});
