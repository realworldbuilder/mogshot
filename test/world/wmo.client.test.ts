import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session } from '../../cli/session';
import { parseTileObjects, parseWdt, tileOf } from '../../src/formats/adt';
import { parseWmoGroup, parseWmoRoot, type WmoGroup, type WmoRoot } from '../../src/formats/wmo';
import { invert, type Mat4, transformPoint } from '../../src/math/mat4';
import { placementMatrix } from '../../src/world/placement';
import { hasClient, WOW_DIR } from '../node-source';

const ROOT = join(import.meta.dirname, '..', '..');
/** Eastern Kingdoms' tile list. */
const AZEROTH_WDT = 775971;
/** Stormwind's Trade District, by the bank. */
const TRADE_DISTRICT = { x: -8833, y: 628 };

/** Height of the highest surface under a point, in the building's own space. */
function groundUnder(groups: WmoGroup[], x: number, y: number): number | undefined {
  let best: number | undefined;
  for (const group of groups) {
    if (x < group.bounds.min[0] || x > group.bounds.max[0] || y < group.bounds.min[1] || y > group.bounds.max[1]) continue;
    const p = group.positions;
    for (let i = 0; i + 2 < group.indices.length; i += 3) {
      const a = group.indices[i]! * 3, b = group.indices[i + 1]! * 3, c = group.indices[i + 2]! * 3;
      // Barycentric coordinates of the point in the triangle seen from above.
      const d = (p[b + 1]! - p[c + 1]!) * (p[a]! - p[c]!) + (p[c]! - p[b]!) * (p[a + 1]! - p[c + 1]!);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((p[b + 1]! - p[c + 1]!) * (x - p[c]!) + (p[c]! - p[b]!) * (y - p[c + 1]!)) / d;
      const v = ((p[c + 1]! - p[a + 1]!) * (x - p[c]!) + (p[a]! - p[c]!) * (y - p[c + 1]!)) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const z = u * p[a + 2]! + v * p[b + 2]! + (1 - u - v) * p[c + 2]!;
      if (best === undefined || z > best) best = z;
    }
  }
  return best;
}

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('Stormwind', () => {
  let session: Session;
  let root: WmoRoot;
  let world: Mat4;
  let groups: WmoGroup[];

  beforeAll(async () => {
    session = await Session.open(WOW_DIR, join(ROOT, 'node_modules', '.cache', 'mogshot', 'cli'));
    const tiles = parseWdt((await session.storage.readFile(AZEROTH_WDT))!.data);
    const { tileX, tileY } = tileOf(TRADE_DISTRICT.x, TRADE_DISTRICT.y);
    const tile = tiles[tileY * 64 + tileX]!;
    const { buildings, doodads } = parseTileObjects((await session.storage.readFile(tile.objects))!.data);
    console.log('tile', tileX, tileY, 'buildings', buildings.length, 'props', doodads.length);
    // The city is the one building big enough to hold the district.
    expect(buildings.length).toBeGreaterThan(0);
    const city = buildings[0]!;
    root = parseWmoRoot((await session.storage.readFile(city.fileId))!.data);
    world = placementMatrix(city);
    groups = [];
    for (const id of root.groupFileIds) groups.push(parseWmoGroup((await session.storage.readFile(id))!.data));
  }, 120_000);

  it('is read whole: groups, materials, textures and props all on disk', () => {
    expect(root.groupFileIds.length).toBeGreaterThan(100);
    expect(groups.length).toBe(root.groupFileIds.length);
    let vertices = 0, triangles = 0;
    for (const group of groups) {
      vertices += group.positions.length / 3;
      triangles += group.indices.length / 3;
      expect(group.normals.length).toBe(group.positions.length);
      expect(group.uvs.length).toBe((group.positions.length / 3) * 2);
      if (group.colours) expect(group.colours.length).toBeGreaterThanOrEqual((group.positions.length / 3) * 4);
      for (const batch of group.batches) {
        expect(batch.material).toBeLessThan(root.materials.length);
        expect(batch.indexStart + batch.indexCount).toBeLessThanOrEqual(group.indices.length);
      }
      for (const ref of group.doodadRefs) expect(ref).toBeLessThan(root.doodads.length);
    }
    const textures = new Set(root.materials.flatMap((m) => m.textures).filter((id) => id > 0));
    const missingTextures = [...textures].filter((id) => session.storage.files.find(id) === undefined);
    const models = new Set(root.doodads.map((d) => d.fileId));
    const missingModels = [...models].filter((id) => session.storage.files.find(id) === undefined);
    console.log(
      `groups ${groups.length}, vertices ${vertices}, triangles ${triangles}, materials ${root.materials.length},`,
      `textures ${textures.size} (${missingTextures.length} missing), props ${root.doodads.length} of ${models.size} models (${missingModels.length} missing),`,
      `sets ${root.doodadSets.map((s) => `${s.name} ${s.start}+${s.count}`).join('; ')}`,
    );
    expect(missingTextures).toEqual([]);
    expect(missingModels.length).toBeLessThan(models.size / 10);
  });

  it('stands where the game puts it: the Trade District is ground, at the height the game reports', () => {
    const local = transformPoint(invert(new Float32Array(16), world), [TRADE_DISTRICT.x, TRADE_DISTRICT.y, 0]);
    const height = groundUnder(groups, local[0], local[1]);
    expect(height).toBeDefined();
    const [x, y, z] = transformPoint(world, [local[0], local[1], height!]);
    console.log('ground under the Trade District', x.toFixed(1), y.toFixed(1), z.toFixed(2));
    expect(x).toBeCloseTo(TRADE_DISTRICT.x, 0);
    expect(y).toBeCloseTo(TRADE_DISTRICT.y, 0);
    // /script print(UnitPosition("player")) there gives a height in the nineties.
    expect(z).toBeGreaterThan(85);
    expect(z).toBeLessThan(110);
  });
});
