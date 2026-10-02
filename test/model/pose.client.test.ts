import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { type M2Model, parseM2, VERTEX_SIZE } from '../../src/formats/m2';
import { parseSkin, type Skin } from '../../src/formats/skin';
import { findSequence, poseBones } from '../../src/model/pose';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

/** Bounding box of the skin's vertices after posing, as [min, max]. */
function posedBounds(model: M2Model, skin: Skin, bones: Float32Array, sectionIds?: (id: number) => boolean) {
  const dv = new DataView(model.vertices.buffer, model.vertices.byteOffset, model.vertices.byteLength);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const section of skin.sections) {
    if (sectionIds && !sectionIds(section.id)) continue;
    for (let v = section.vertexStart; v < section.vertexStart + section.vertexCount; v++) {
      const at = skin.vertexLookup[v]! * VERTEX_SIZE;
      const p = [dv.getFloat32(at, true), dv.getFloat32(at + 4, true), dv.getFloat32(at + 8, true)];
      const out = [0, 0, 0];
      let total = 0;
      for (let k = 0; k < 4; k++) {
        const weight = model.vertices[at + 12 + k]! / 255;
        if (weight === 0) continue;
        total += weight;
        const m = model.vertices[at + 16 + k]! * 16;
        for (let c = 0; c < 3; c++) {
          out[c]! += weight * (bones[m + c]! * p[0]! + bones[m + 4 + c]! * p[1]! + bones[m + 8 + c]! * p[2]! + bones[m + 12 + c]!);
        }
      }
      for (let c = 0; c < 3; c++) {
        const value = total > 0 ? out[c]! / total : p[c]!;
        if (value < min[c]!) min[c] = value;
        if (value > max[c]!) max[c] = value;
      }
    }
  }
  return { min, max };
}

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('posing the human male', () => {
  let model: M2Model;
  let skin: Skin;

  beforeAll(async () => {
    const storage = await CascStorage.open(new NodeSource(WOW_DIR));
    model = parseM2((await storage.readFile(1011653))!.data);
    skin = parseSkin((await storage.readFile(model.skinFileIds[0]!))!.data);
  }, 120_000);

  it('produces finite matrices for Stand', () => {
    const bones = poseBones(model, findSequence(model.sequences, 0), 0);
    expect(bones.length).toBe(model.bones.length * 16);
    expect(bones.every(Number.isFinite)).toBe(true);
  });

  it('stands upright on the ground at a human height', () => {
    const bones = poseBones(model, findSequence(model.sequences, 0), 0);
    // The body with nothing chosen: section 0 plus variant 1 of each group (bare hands, feet, legs).
    const { min, max } = posedBounds(model, skin, bones, (id) => id === 0 || id % 100 === 1);
    console.log('posed body bounds', min.map((v) => v.toFixed(2)), max.map((v) => v.toFixed(2)));
    expect(max[2]! - min[2]!).toBeGreaterThan(1.6);
    expect(max[2]!).toBeLessThan(2.6);
    expect(Math.abs(min[2]!)).toBeLessThan(0.3);
    // Arms hang at the sides in Stand: the body is much taller than it is wide.
    expect(max[1]! - min[1]!).toBeLessThan(max[2]! - min[2]!);
  });

  it('differs from the rest pose', () => {
    const rest = poseBones(model, -1, 0);
    const stand = poseBones(model, findSequence(model.sequences, 0), 0);
    let different = 0;
    for (let i = 0; i < rest.length; i++) if (Math.abs(rest[i]! - stand[i]!) > 1e-4) different++;
    expect(different).toBeGreaterThan(100);
    const a = posedBounds(model, skin, rest);
    const b = posedBounds(model, skin, stand);
    console.log('rest width', (a.max[1]! - a.min[1]!).toFixed(2), 'stand width', (b.max[1]! - b.min[1]!).toFixed(2));
  });
});
