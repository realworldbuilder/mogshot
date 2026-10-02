import type { CascStorage } from '../casc/storage';
import { decodeBlp, type Image } from '../formats/blp';
import { parseM2, VERTEX_SIZE } from '../formats/m2';
import { parseSkin, type Skin } from '../formats/skin';
import { findSequence, poseBones } from '../model/pose';
import type { Appearance, TextureLayer } from './appearance';
import { composite, type CompositeLayer } from './compositor';

export interface SceneTexture extends Image {
  wrapX: boolean;
  wrapY: boolean;
}

/** One batch of triangles drawn with one material. */
export interface SceneDraw {
  /** Geoset ID of the section, for messages. */
  sectionId: number;
  indexStart: number;
  indexCount: number;
  /** The model's shader selector and texture count; the renderer maps them to a combiner. */
  shaderId: number;
  textureCount: number;
  blendMode: number;
  /** Material flags: 0x1 unlit, 0x4 two-sided, 0x8 no depth test, 0x10 no depth write. */
  materialFlags: number;
  priority: number;
  layer: number;
  /** Indices into the scene's textures, one per texture stage; -1 where there is none. */
  textures: number[];
}

/** Everything the renderer needs to draw one posed character. Plain data, so it can cross from the worker. */
export interface CharacterScene {
  /** 48-byte vertices as stored in the model: position, bone weights, bone indices, normal, two UV sets. */
  vertices: Uint8Array;
  indices: Uint16Array;
  draws: SceneDraw[];
  textures: SceneTexture[];
  /** One 4x4 matrix per bone for the pose. */
  bones: Float32Array;
  /** Box around the posed, visible geometry. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Anything that could not be read or resolved. Empty means the picture is complete. */
  problems: string[];
}

export interface CharacterRequest {
  raceId: number;
  /** 0 = male, 1 = female. */
  sex: number;
  /** Option ID -> choice ID. Options left out use their first available choice. */
  choices?: ReadonlyMap<number, number>;
}

/** Geoset groups that are extras (eye glow and the like): hidden unless a choice asks for them. */
const GROUPS_HIDDEN_BY_DEFAULT = new Set([17, 35]);
const ANIMATION_STAND = 0;

/** Which sections of the skin are drawn, given the geosets the choices ask for. */
export function visibleSections(skin: Skin, requests: readonly { group: number; variant: number }[]): boolean[] {
  const present = new Set(skin.sections.map((section) => section.id));
  const active = new Map<number, number>();
  for (const { group, variant } of requests) {
    // Variant 0 means none of the group. A variant this model does not have leaves the
    // group as it was: hiding it would remove part of the body on some races.
    if (variant === 0 || present.has(group * 100 + variant)) active.set(group, variant);
  }
  return skin.sections.map(({ id }) => {
    // Section 0 is part of the body (shoulders and upper arms on newer models), not a hair style.
    if (id === 0) return true;
    const group = Math.floor(id / 100);
    const fallback = GROUPS_HIDDEN_BY_DEFAULT.has(group) ? 0 : 1;
    return id % 100 === (active.get(group) ?? fallback);
  });
}

/**
 * The size to composite a slot's texture at. The game data gives the full size; an install
 * with smaller textures gains nothing from stretching them, so scale down to the sharpest layer.
 */
function compositeScale(layers: readonly { layer: TextureLayer; image: Image }[]): number {
  let scale = 1 / 8;
  for (const { layer, image } of layers) scale = Math.max(scale, image.width / layer.width, image.height / layer.height);
  let power = 1;
  while (power / 2 >= scale) power /= 2;
  return Math.min(1, power);
}

export async function buildCharacterScene(
  storage: CascStorage,
  appearance: Appearance,
  request: CharacterRequest,
): Promise<CharacterScene> {
  const problems: string[] = [];
  const characterModel = appearance.model(request.raceId, request.sex);
  if (!characterModel) throw new Error(`The game data has no model for race ${request.raceId}, sex ${request.sex}`);

  const read = async (fileId: number, what: string): Promise<Uint8Array | undefined> => {
    const file = await storage.readFile(fileId);
    if (!file) {
      const why = storage.files.isMissing(fileId) ? 'is not installed' : 'is not part of this build';
      problems.push(`${what} (file ${fileId}) ${why}`);
      return undefined;
    }
    if (file.encrypted.length > 0) problems.push(`${what} (file ${fileId}) is partly encrypted`);
    return file.data;
  };

  const modelBytes = await read(characterModel.fileId, 'The character model');
  if (!modelBytes) throw new Error(problems[0]);
  const model = parseM2(modelBytes);
  const skinBytes = await read(model.skinFileIds[0] ?? 0, 'The model skin');
  if (!skinBytes) throw new Error(problems[problems.length - 1]);
  const skin = parseSkin(skinBytes);

  const choices = new Map(appearance.defaultChoices(characterModel.chrModelId));
  for (const [option, choice] of request.choices ?? []) choices.set(option, choice);
  const resolved = appearance.resolve(characterModel, choices);
  problems.push(...resolved.problems);
  if (resolved.boneSets.length > 0) problems.push('Face shape: bone sets are not applied yet, so the face keeps its base shape');
  if (resolved.skinnedModels.length > 0) problems.push('An appearance choice attaches a model, which is not drawn yet');

  // Composite one texture per slot from the layers the choices produce.
  const images = new Map<number, Image | undefined>();
  const image = async (fileId: number, what: string): Promise<Image | undefined> => {
    if (!images.has(fileId)) {
      const bytes = await read(fileId, what);
      images.set(fileId, bytes && decodeBlp(bytes));
    }
    return images.get(fileId);
  };
  const slots = new Map<number, Image>();
  for (const type of new Set(resolved.layers.map((layer) => layer.textureType))) {
    const loaded: { layer: TextureLayer; image: Image }[] = [];
    for (const layer of resolved.layers) {
      if (layer.textureType !== type) continue;
      const loadedImage = await image(layer.fileId, `An appearance texture (slot ${type}, layer ${layer.layer})`);
      if (loadedImage) loaded.push({ layer, image: loadedImage });
    }
    const first = loaded[0];
    if (!first) continue;
    const scale = compositeScale(loaded);
    const layers: CompositeLayer[] = loaded.map(({ layer, image }) => ({
      image,
      x: layer.x * scale,
      y: layer.y * scale,
      width: layer.width * scale,
      height: layer.height * scale,
      blendMode: layer.blendMode,
    }));
    slots.set(type, composite(first.layer.canvasWidth * scale, first.layer.canvasHeight * scale, layers));
  }

  // Draw list: the batches of visible sections, with their textures.
  const visible = visibleSections(skin, resolved.geosets);
  const textures: SceneTexture[] = [];
  const sceneTextureOf = new Map<number, number>();
  const textureFor = async (modelTexture: number, sectionId: number): Promise<number> => {
    const known = sceneTextureOf.get(modelTexture);
    if (known !== undefined) return known;
    const texture = model.textures[modelTexture];
    let picture: Image | undefined;
    if (!texture) problems.push(`Geoset ${sectionId} uses texture ${modelTexture}, which the model does not have`);
    else if (texture.type === 0) picture = await image(texture.fileId, 'A model texture');
    else {
      picture = slots.get(texture.type);
      if (!picture) problems.push(`Geoset ${sectionId} needs a texture for slot ${texture.type}, and nothing fills it`);
    }
    let index = -1;
    if (picture && texture) {
      index = textures.length;
      textures.push({ ...picture, wrapX: (texture.flags & 1) !== 0, wrapY: (texture.flags & 2) !== 0 });
    }
    sceneTextureOf.set(modelTexture, index);
    return index;
  };

  const draws: SceneDraw[] = [];
  for (const batch of skin.batches) {
    if (!visible[batch.sectionIndex]) continue;
    const section = skin.sections[batch.sectionIndex]!;
    const material = model.materials[batch.materialIndex];
    const stageTextures: number[] = [];
    for (let stage = 0; stage < Math.min(batch.textureCount, 4); stage++) {
      const modelTexture = model.textureCombos[batch.textureComboIndex + stage];
      stageTextures.push(modelTexture === undefined ? -1 : await textureFor(modelTexture, section.id));
    }
    draws.push({
      sectionId: section.id,
      indexStart: section.indexStart,
      indexCount: section.indexCount,
      shaderId: batch.shaderId,
      textureCount: batch.textureCount,
      blendMode: material?.blendMode ?? 0,
      materialFlags: material?.flags ?? 0,
      priority: batch.priority,
      layer: batch.materialLayer,
      textures: stageTextures,
    });
  }

  // The skin uses a prefix of the model's vertices; triangles index them through its lookup.
  let vertexCount = 0;
  for (const v of skin.vertexLookup) if (v >= vertexCount) vertexCount = v + 1;
  const vertices = model.vertices.slice(0, vertexCount * VERTEX_SIZE);
  const indices = new Uint16Array(skin.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = skin.vertexLookup[skin.indices[i]!]!;

  const stand = findSequence(model.sequences, ANIMATION_STAND);
  if (stand < 0) problems.push('The model has no Stand animation, so it is shown in its rest pose');
  const bones = poseBones(model, stand, 0);

  return { vertices, indices, draws, textures, bones, bounds: posedBounds(vertices, skin, visible, bones), problems };
}

/** Box around the vertices of the visible sections after posing. */
function posedBounds(vertices: Uint8Array, skin: Skin, visible: boolean[], bones: Float32Array): CharacterScene['bounds'] {
  const dv = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  skin.sections.forEach((section, sectionIndex) => {
    if (!visible[sectionIndex]) return;
    for (let v = section.vertexStart; v < section.vertexStart + section.vertexCount; v++) {
      const at = skin.vertexLookup[v]! * VERTEX_SIZE;
      const x = dv.getFloat32(at, true);
      const y = dv.getFloat32(at + 4, true);
      const z = dv.getFloat32(at + 8, true);
      const posed = [0, 0, 0];
      let total = 0;
      for (let k = 0; k < 4; k++) {
        const weight = vertices[at + 12 + k]!;
        if (weight === 0) continue;
        total += weight;
        const m = vertices[at + 16 + k]! * 16;
        for (let c = 0; c < 3; c++) {
          posed[c]! += weight * (bones[m + c]! * x + bones[m + 4 + c]! * y + bones[m + 8 + c]! * z + bones[m + 12 + c]!);
        }
      }
      const rest = [x, y, z];
      for (let c = 0; c < 3; c++) {
        const value = total > 0 ? posed[c]! / total : rest[c]!;
        if (value < min[c]!) min[c] = value;
        if (value > max[c]!) max[c] = value;
      }
    }
  });
  return { min, max };
}
