import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { decodeBlp } from '../../src/formats/blp';
import { type M2Model, parseM2, SEQUENCE_INLINE, VERTEX_SIZE } from '../../src/formats/m2';
import { parseSkin, type Skin } from '../../src/formats/skin';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

const HUMAN_MALE = 1011653;

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('human male model files', () => {
  let storage: CascStorage;
  let model: M2Model;
  let skin: Skin;

  beforeAll(async () => {
    storage = await CascStorage.open(new NodeSource(WOW_DIR));
    model = parseM2((await storage.readFile(HUMAN_MALE))!.data);
    skin = parseSkin((await storage.readFile(model.skinFileIds[0]!))!.data);
  }, 120_000);

  it('parses the model header', () => {
    expect(model.version).toBeGreaterThanOrEqual(272);
    expect(model.vertexCount).toBeGreaterThan(10_000);
    expect(model.vertices.length).toBe(model.vertexCount * VERTEX_SIZE);
    expect(model.bones.length).toBeGreaterThan(100);
    expect(model.skinFileIds.length).toBeGreaterThanOrEqual(model.skinProfileCount);
    // Slots the character fills: 1 = skin, 6 = hair.
    expect(model.textures.map((t) => t.type)).toEqual(expect.arrayContaining([1, 6]));
  });

  it('has a Stand sequence stored inside the model', () => {
    const stand = model.sequences.find((s) => s.id === 0 && s.variation === 0);
    expect(stand).toBeDefined();
    expect(stand!.flags & SEQUENCE_INLINE).not.toBe(0);
  });

  it('has sane bone parents', () => {
    model.bones.forEach((bone, i) => {
      expect(bone.parent).toBeGreaterThanOrEqual(-1);
      expect(bone.parent).toBeLessThan(model.bones.length);
      expect(bone.parent).not.toBe(i);
    });
  });

  it('parses the first skin consistently with the model', () => {
    expect(skin.sections.some((s) => s.id === 0)).toBe(true);
    for (const v of skin.vertexLookup) expect(v).toBeLessThan(model.vertexCount);
    for (const section of skin.sections) {
      expect(section.indexStart + section.indexCount).toBeLessThanOrEqual(skin.indices.length);
    }
    for (const batch of skin.batches) {
      expect(batch.sectionIndex).toBeLessThan(skin.sections.length);
      expect(batch.materialIndex).toBeLessThan(model.materials.length);
      expect(batch.textureComboIndex + batch.textureCount).toBeLessThanOrEqual(model.textureCombos.length);
    }
  });

  it('decodes a texture the model names', async () => {
    const fileId = model.textures.find((t) => t.fileId !== 0)!.fileId;
    const image = decodeBlp((await storage.readFile(fileId))!.data);
    expect(image.width).toBeGreaterThan(0);
    expect(image.pixels.length).toBe(image.width * image.height * 4);
    expect(image.pixels.some((v) => v !== 0)).toBe(true);
  });
});
