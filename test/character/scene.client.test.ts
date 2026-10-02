import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { Appearance } from '../../src/character/appearance';
import { buildCharacterScene, type CharacterScene } from '../../src/character/scene';
import type { CascStorage as Storage } from '../../src/casc/storage';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import { cachedFetch } from '../cached-fetch';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';
import { writePng } from '../png';

/** Build a character and return just the scene. */
const buildScene = async (...args: Parameters<typeof buildCharacterScene>) => (await buildCharacterScene(...args)).scene;

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('human male scene', () => {
  let storage: Storage;
  let appearance: Appearance;
  let scene: CharacterScene;

  beforeAll(async () => {
    storage = await CascStorage.open(new NodeSource(WOW_DIR));
    const definitions = new Definitions(async (url) => {
      const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
      if (text === undefined) throw new Error(`Could not fetch ${url}`);
      return text;
    });
    appearance = await Appearance.load(new Database(storage, definitions));
    scene = await buildScene(storage, appearance, undefined, { raceId: 1, sex: 0 });
    // Kept for looking at by eye; test-results/ is not committed.
    scene.textures.forEach((texture, i) => writePng(`test-results/scene/texture-${i}.png`, texture));
  }, 120_000);

  it('offers the human male options with available choices', () => {
    const model = appearance.model(1, 0)!;
    const options = appearance.options(model.chrModelId);
    expect(options.map((o) => o.name)).toEqual(expect.arrayContaining(['Skin Color', 'Face', 'Hair Style', 'Hair Color']));
    const offered = options.filter((o) => !o.hidden);
    for (const option of offered) expect(option.choices.some((c) => c.available)).toBe(true);
    const defaults = appearance.defaultChoices(model.chrModelId);
    for (const option of offered) expect(defaults.has(option.id)).toBe(true);
  });

  it('draws the body with every stage textured', () => {
    const draws = scene.meshes.flatMap((mesh) => mesh.draws);
    expect(scene.meshes).toHaveLength(1);
    expect(draws.some((d) => d.sectionId === 0)).toBe(true);
    for (const draw of draws) expect(draw.textures.every((t) => t >= 0)).toBe(true);
  });

  it('has nothing to report as missing', () => {
    expect(scene.problems).toEqual([]);
  });

  it('returns the options and the choices in effect', () => {
    expect(scene.options.length).toBeGreaterThan(5);
    expect(scene.choices.length).toBeGreaterThanOrEqual(scene.options.filter((o) => !o.hidden).length);
  });

  it('stands about two units tall on the ground', () => {
    const { min, max } = scene.bounds;
    expect(max[2] - min[2]).toBeGreaterThan(1.6);
    expect(max[2] - min[2]).toBeLessThan(2.6);
    expect(Math.abs(min[2])).toBeLessThan(0.1);
  });

  it('indexes only vertices it carries', () => {
    for (const mesh of scene.meshes) {
      const count = mesh.vertices.length / 48;
      for (const draw of mesh.draws) {
        for (let i = draw.indexStart; i < draw.indexStart + draw.indexCount; i++) expect(mesh.indices[i]).toBeLessThan(count);
      }
    }
  });

  it('builds every race and sex the game lets you create, with nothing missing', async () => {
    expect(appearance.races.length).toBeGreaterThanOrEqual(8);
    const report: string[] = [];
    for (const race of appearance.races) {
      for (const sex of race.sexes) {
        const built = await buildScene(storage, appearance, undefined, { raceId: race.id, sex });
        const draws = built.meshes.flatMap((mesh) => mesh.draws);
        const untextured = draws.filter((d) => d.textures.some((t) => t < 0)).map((d) => d.sectionId);
        const height = built.bounds.max[2] - built.bounds.min[2];
        report.push(
          `${race.name} ${sex ? 'female' : 'male'}: ${built.meshes.length} meshes, ${draws.length} draws, height ${height.toFixed(2)}` +
            (built.problems.length ? ` PROBLEMS ${built.problems.join('; ')}` : '') +
            (untextured.length ? ` UNTEXTURED ${untextured}` : ''),
        );
        expect.soft(built.problems, `${race.name} ${sex}`).toEqual([]);
        expect.soft(untextured, `${race.name} ${sex}`).toEqual([]);
        expect.soft(height, `${race.name} ${sex}`).toBeGreaterThan(0.8);
        expect.soft(height, `${race.name} ${sex}`).toBeLessThan(3.5);
      }
    }
    console.log(report.join('\n'));
  }, 120_000);
});
