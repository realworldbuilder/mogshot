import type { CascStorage } from '../casc/storage';
import { decodeBlp, type Image } from '../formats/blp';
import { type BoneOffsets, parseBoneFile } from '../formats/bone';
import { BONE_BILLBOARD, type M2Model, parseM2, VERTEX_SIZE } from '../formats/m2';
import { parseSkin, type Skin } from '../formats/skin';
import { identity, multiply } from '../math/mat4';
import { findSequence, fingerBones, poseBones } from '../model/pose';
import type { Appearance, Option, TextureLayer } from './appearance';
import { composite, type CompositeLayer } from './compositor';
import type { Equipment, ItemLook, Slot } from './equipment';

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

/** The geometry of one model file, posed. */
export interface SceneMesh {
  /** 48-byte vertices as stored in the model: position, bone weights, bone indices, normal, two UV sets. */
  vertices: Uint8Array;
  indices: Uint16Array;
  /** One 4x4 matrix per bone for the pose. */
  bones: Float32Array;
  /** Where the mesh sits: identity for the body and things worn on it, the attachment point for things held or mounted. */
  transform: Float32Array;
  /** Bones that turn to face the camera, with the point each turns about. The renderer aims them. */
  billboards: { bone: number; pivot: [number, number, number] }[];
  draws: SceneDraw[];
}

/** Everything the renderer needs to draw one posed character. Plain data, so it can cross from the worker. */
export interface CharacterScene {
  /** The character's own model first, then any models its appearance adds. */
  meshes: SceneMesh[];
  textures: SceneTexture[];
  /** Box around the posed, visible geometry. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Anything that could not be read or resolved. Empty means the picture is complete. */
  problems: string[];
  /** The appearance options of this race and sex, and the choice in effect for each. */
  options: Option[];
  choices: [optionId: number, choiceId: number][];
}

export interface CharacterRequest {
  raceId: number;
  /** 0 = male, 1 = female. */
  sex: number;
  /** Option ID -> choice ID. Options left out use their first available choice. */
  choices?: ReadonlyMap<number, number>;
  /** Item ID worn in each slot. */
  gear?: ReadonlyMap<Slot, number>;
}

/**
 * Which geoset groups an item's six geoset numbers select, by slot. An entry is
 * [position in the item's list, geoset group]. The variant shown is 1 + the number
 * (0, the usual value, is the plain variant 1). From wow.export's slot table.
 */
const SLOT_GEOSETS: Record<Slot, [index: number, group: number][]> = {
  head: [[0, 27], [1, 21]],
  shoulder: [[0, 26]],
  back: [[0, 15]],
  chest: [[0, 8], [1, 10], [2, 13], [3, 22], [4, 28]],
  shirt: [[0, 8], [1, 10]],
  tabard: [[0, 12]],
  wrist: [],
  hands: [[0, 4], [1, 23]],
  waist: [[0, 18]],
  legs: [[0, 11], [1, 9], [2, 13]],
  feet: [[0, 5], [1, 20]],
  mainHand: [],
  offHand: [],
};
const GROUP_FEET = 20;
const GROUP_BOOTS = 5;
const GROUP_KNEEPADS = 9;
const GROUP_PANTS = 11;
/** Position of the skirt (trousers group) in a chest item's geoset list. */
const ROBE_SKIRT = 2;
/** Body texture sections of the upper and lower leg. */
const LEG_SECTIONS = [5, 6];

/** Slots from lowest to highest priority where two items select the same geoset group or paint the same place. */
const GEOSET_ORDER: Slot[] = ['shirt', 'legs', 'feet', 'chest', 'tabard', 'waist', 'wrist', 'hands', 'shoulder', 'head', 'back'];
const TEXTURE_ORDER: Slot[] = ['shirt', 'legs', 'head', 'feet', 'shoulder', 'chest', 'tabard', 'waist', 'wrist', 'hands', 'mainHand', 'offHand', 'back'];

/** Attachment points on the character, by the model's attachment IDs. */
const ATTACH = { shield: 0, rightHand: 1, leftHand: 2, rightShoulder: 5, leftShoulder: 6, helm: 11, back: 12, buckle: 53 } as const;
const ANIMATION_HANDS_CLOSED = 15;

/** Geoset groups that are extras (eye glow and the like): hidden unless a choice asks for them. */
const GROUPS_HIDDEN_BY_DEFAULT = new Set([17, 35]);
/** The face. Part of it is common to every face shape and is drawn whichever shape is chosen. */
const GROUP_FACE = 32;
const ANIMATION_STAND = 0;

/**
 * Which sections of the skin are drawn.
 *
 * A section's ID is group * 100 + variant, and each group shows one variant: variant 1 unless
 * a choice selects another (bare hands are 401, a glove style 402 ...). A choice that names
 * variant 0 hides the group. A choice that names a variant the model does not have leaves
 * the group as it was: hiding it would remove part of the body on some races.
 *
 * Two exceptions. Section 0 is part of the body and is always drawn, although "Bald" names
 * it. And the face group is drawn whole, except that where an option's choices name
 * variants (face shapes), only the chosen one of those is drawn.
 */
export function visibleSections(skin: Skin, toggles: readonly { id: number; visible: boolean }[]): boolean[] {
  const present = new Set(skin.sections.map((section) => section.id));
  const named = new Set<number>();
  const selected = new Map<number, number>();
  for (const { id, visible } of toggles) {
    named.add(id);
    if (!visible) continue;
    const variant = id % 100;
    if (variant === 0 || present.has(id)) selected.set(Math.floor(id / 100), variant);
  }
  return skin.sections.map(({ id }) => {
    if (id === 0) return true;
    const group = Math.floor(id / 100);
    const variant = id % 100;
    if (group === GROUP_FACE) return !named.has(id) || selected.get(group) === variant;
    return variant === (selected.get(group) ?? (GROUPS_HIDDEN_BY_DEFAULT.has(group) ? 0 : 1));
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

/**
 * Bone matrices for a model that is worn by the character rather than animated itself.
 * Each of its bones takes the matrix of the character's bone with the same name; a bone
 * the character lacks follows its parent.
 */
function wornBones(model: M2Model, body: M2Model, bodyBones: Float32Array): Float32Array {
  const bodyIndex = new Map<number, number>();
  body.bones.forEach((bone, i) => {
    if (!bodyIndex.has(bone.nameHash)) bodyIndex.set(bone.nameHash, i);
  });
  const out = new Float32Array(model.bones.length * 16);
  const done = new Uint8Array(model.bones.length);
  const solve = (i: number): Float32Array => {
    const matrix = out.subarray(i * 16, i * 16 + 16);
    if (done[i]) return matrix;
    done[i] = 1;
    const bone = model.bones[i]!;
    const match = bodyIndex.get(bone.nameHash);
    if (match !== undefined) matrix.set(bodyBones.subarray(match * 16, match * 16 + 16));
    else if (bone.parent >= 0) matrix.set(solve(bone.parent));
    else identity(matrix);
    return matrix;
  };
  for (let i = 0; i < model.bones.length; i++) solve(i);
  return out;
}

/** True if a model's bones are (mostly) named after the body's: it is skinned to the body, not mounted on it. */
function skinnedTo(model: M2Model, body: M2Model): boolean {
  const names = new Set(body.bones.map((bone) => bone.nameHash).filter((hash) => hash !== 0));
  const matched = model.bones.filter((bone) => names.has(bone.nameHash)).length;
  return matched >= 2 && matched * 2 >= model.bones.length;
}

/** The character's attachment point as a matrix: the bone it rides, then its offset. */
function attachmentMatrix(body: M2Model, bones: Float32Array, attachmentId: number): Float32Array | undefined {
  const attachment = body.attachments[body.attachmentLookup[attachmentId] ?? -1];
  if (!attachment || attachment.bone >= body.bones.length) return undefined;
  const offset = identity();
  offset.set(attachment.position, 12);
  return multiply(new Float32Array(16), bones.subarray(attachment.bone * 16, attachment.bone * 16 + 16), offset);
}

export async function buildCharacterScene(
  storage: CascStorage,
  appearance: Appearance,
  equipment: Equipment | undefined,
  request: CharacterRequest,
): Promise<CharacterScene> {
  const problems: string[] = [];
  const characterModel = appearance.model(request.raceId, request.sex);
  if (!characterModel) throw new Error(`The game data has no model for race ${request.raceId}, sex ${request.sex}`);

  // Files that belong to an item are reported under the item's name.
  const itemOfFile = new Map<number, string>();
  const named = (fileId: number, what: string) => {
    const item = itemOfFile.get(fileId);
    return item ? `${item}: ${what.charAt(0).toLowerCase()}${what.slice(1)}` : what;
  };
  const read = async (fileId: number, what: string): Promise<Uint8Array | undefined> => {
    const file = await storage.readFile(fileId);
    if (!file) {
      const why = storage.files.isMissing(fileId) ? 'is not installed' : 'is not part of this build';
      problems.push(`${named(fileId, what)} (file ${fileId}) ${why}`);
      return undefined;
    }
    if (file.encrypted.length > 0) problems.push(`${named(fileId, what)} (file ${fileId}) is partly encrypted`);
    return file.data;
  };
  const readModel = async (fileId: number, what: string): Promise<{ model: M2Model; skin: Skin } | undefined> => {
    const modelBytes = await read(fileId, what);
    if (!modelBytes) return undefined;
    const model = parseM2(modelBytes);
    const skinBytes = await read(model.skinFileIds[0] ?? 0, `${what}'s skin`);
    return skinBytes && { model, skin: parseSkin(skinBytes) };
  };

  const body = await readModel(characterModel.fileId, 'The character model');
  if (!body) throw new Error(problems[problems.length - 1]);
  const { model, skin } = body;
  if (model.skeletonFileId !== 0) {
    throw new Error('This model keeps its skeleton in a separate file, which Mogshot cannot read yet');
  }

  const options = appearance.options(characterModel.chrModelId);
  const choices = new Map(appearance.defaultChoices(characterModel.chrModelId));
  for (const [option, choice] of request.choices ?? []) {
    // Ignore choices that belong to another race or sex.
    if (options.some((o) => o.id === option && o.choices.some((c) => c.id === choice))) choices.set(option, choice);
  }
  const resolved = appearance.resolve(characterModel, choices);
  problems.push(...resolved.problems);
  // A model added by a choice replaces the body's own geosets of that group.
  for (const { group } of resolved.skinnedModels) resolved.geosets.push({ id: group * 100, visible: true });

  // What is worn: geosets and body textures now, models once the body is posed.
  const worn = new Map<Slot, ItemLook>();
  for (const [slot, itemId] of request.gear ?? []) {
    const look = equipment?.look(itemId, slot, request.raceId, request.sex);
    if (look) worn.set(slot, look);
    else problems.push(`Item ${itemId} is not in the game data`);
  }
  // A robe: a chest item with a skirt. The skirt covers the legs, so boot tops, kneepads and
  // trouser legs are not drawn under it, and leg armour is not painted on it.
  const robe = (worn.get('chest')?.geosetGroup[ROBE_SKIRT] ?? 0) > 0;
  for (const slot of GEOSET_ORDER) {
    const look = worn.get(slot);
    if (!look) continue;
    for (const [index, group] of SLOT_GEOSETS[slot]) {
      const value = look.geosetGroup[index] ?? 0;
      // Boots list their foot geoset directly; 0 there means the booted foot, variant 2.
      const variant = group === GROUP_FEET ? value || 2 : 1 + value;
      resolved.geosets.push({ id: group * 100 + variant, visible: true });
    }
    for (const group of look.hideGroups) resolved.geosets.push({ id: group * 100, visible: true });
    if (slot === 'chest' && robe) {
      resolved.geosets.push({ id: GROUP_BOOTS * 100 + 1, visible: true });
      resolved.geosets.push({ id: GROUP_KNEEPADS * 100, visible: true });
      resolved.geosets.push({ id: GROUP_PANTS * 100, visible: true });
    }
  }
  TEXTURE_ORDER.forEach((slot, order) => {
    const look = worn.get(slot);
    if (!look) return;
    for (const { section, fileId } of look.bodyTextures) {
      if (robe && (slot === 'legs' || slot === 'feet') && LEG_SECTIONS.includes(section)) continue;
      const layer = appearance.bodyLayer(characterModel, section, fileId, 1000 + order);
      if (layer) resolved.layers.push(layer);
    }
  });
  for (const look of worn.values()) {
    for (const { fileId } of look.bodyTextures) itemOfFile.set(fileId, look.item.name);
    for (const model of look.models) {
      itemOfFile.set(model.fileId, look.item.name);
      for (const fileId of model.textures.values()) itemOfFile.set(fileId, look.item.name);
    }
    for (const fileId of look.characterTextures.values()) itemOfFile.set(fileId, look.item.name);
  }

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
  // Armour is painted over the skin: its layers sort after every appearance layer.
  resolved.layers.sort((a, b) => a.textureType - b.textureType || a.layer - b.layer);
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

  // An item with no model of its own can still fill one of the character's slots: a cloak's cloth.
  for (const look of worn.values()) {
    for (const [type, fileId] of look.characterTextures) {
      if (slots.has(type)) continue;
      const picture = await image(fileId, 'An item texture');
      if (picture) slots.set(type, picture);
    }
  }

  // Scene textures are shared between meshes: a slot (skin, hair ...) or a file is uploaded once.
  const textures: SceneTexture[] = [];
  const sceneTextureOf = new Map<string, number>();
  const textureFor = async (
    source: M2Model,
    modelTexture: number,
    sectionId: number,
    owner: string | undefined,
    overrides: ReadonlyMap<number, number> | undefined,
  ): Promise<number> => {
    const of = owner ? `${owner}: geoset` : 'Geoset';
    const texture = source.textures[modelTexture];
    if (!texture) {
      problems.push(`${of} ${sectionId} uses texture ${modelTexture}, which the model does not have`);
      return -1;
    }
    // A model's own file, a texture the item supplies for the slot, or one of the character's slots.
    const fileId = texture.type === 0 ? texture.fileId : (overrides?.get(texture.type) ?? 0);
    const key = `${fileId ? `file:${fileId}` : `slot:${texture.type}`}:${texture.flags & 3}`;
    const known = sceneTextureOf.get(key);
    if (known !== undefined) return known;
    let picture: Image | undefined;
    if (fileId) picture = await image(fileId, owner ? 'A texture' : 'A model texture');
    else {
      picture = slots.get(texture.type);
      if (!picture) problems.push(`${of} ${sectionId} needs a texture for slot ${texture.type}, and nothing fills it`);
    }
    let index = -1;
    if (picture) {
      index = textures.length;
      textures.push({ ...picture, wrapX: (texture.flags & 1) !== 0, wrapY: (texture.flags & 2) !== 0 });
    }
    sceneTextureOf.set(key, index);
    return index;
  };

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const buildMesh = async (
    source: M2Model,
    sourceSkin: Skin,
    visible: boolean[],
    bones: Float32Array,
    transform: Float32Array = identity(),
    owner?: string,
    overrides?: ReadonlyMap<number, number>,
  ): Promise<SceneMesh> => {
    const draws: SceneDraw[] = [];
    for (const batch of sourceSkin.batches) {
      if (!visible[batch.sectionIndex]) continue;
      const section = sourceSkin.sections[batch.sectionIndex]!;
      const material = source.materials[batch.materialIndex];
      const stageTextures: number[] = [];
      for (let stage = 0; stage < Math.min(batch.textureCount, 4); stage++) {
        const modelTexture = source.textureCombos[batch.textureComboIndex + stage];
        stageTextures.push(modelTexture === undefined ? -1 : await textureFor(source, modelTexture, section.id, owner, overrides));
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
    for (const v of sourceSkin.vertexLookup) if (v >= vertexCount) vertexCount = v + 1;
    const vertices = source.vertices.slice(0, vertexCount * VERTEX_SIZE);
    const indices = new Uint16Array(sourceSkin.indices.length);
    for (let i = 0; i < indices.length; i++) indices[i] = sourceSkin.vertexLookup[sourceSkin.indices[i]!]!;
    growBounds(min, max, vertices, sourceSkin, visible, bones, transform);
    const billboards = source.bones.flatMap((bone, index) =>
      bone.flags & BONE_BILLBOARD ? [{ bone: index, pivot: bone.pivot }] : [],
    );
    return { vertices, indices, bones, transform, billboards, draws };
  };

  // Face shapes and the like: adjustments to some bones, merged in the order the choices give them.
  const boneOffsets: BoneOffsets = new Map();
  for (const fileId of resolved.boneFiles) {
    // The game data names some adjustment files that no build contains; the game shows
    // the base shape for those, so they are not a fault in the picture.
    if (!storage.files.find(fileId) && !storage.files.isMissing(fileId)) continue;
    const bytes = await read(fileId, 'A face shape');
    if (!bytes) continue;
    for (const [bone, matrix] of parseBoneFile(bytes)) boneOffsets.set(bone, matrix);
  }

  const stand = findSequence(model.sequences, ANIMATION_STAND);
  if (stand < 0) problems.push('The model has no Stand animation, so it is shown in its rest pose');

  // A hand closes around what it holds. A bow is held in the left hand; a shield is strapped on, not held.
  const mainHand = worn.get('mainHand');
  const offHand = worn.get('offHand');
  const grip = new Set<number>();
  const holds = (look: ItemLook | undefined) => look !== undefined && look.models.length > 0 && !look.shield;
  if (holds(mainHand) && !mainHand!.bow) for (const bone of fingerBones(model.bones, 'right')) grip.add(bone);
  if (holds(offHand) || (holds(mainHand) && mainHand!.bow)) for (const bone of fingerBones(model.bones, 'left')) grip.add(bone);
  const closed = findSequence(model.sequences, ANIMATION_HANDS_CLOSED);
  const bones = poseBones(model, stand, 0, undefined, boneOffsets, closed >= 0 && grip.size > 0 ? { sequence: closed, bones: grip } : undefined);

  const meshes = [await buildMesh(model, skin, visibleSections(skin, resolved.geosets), bones)];

  // Models the choices add (horns, jewellery, body parts of some races), one mesh per file.
  const wanted = new Map<number, Set<number>>();
  for (const { fileId, group, variant } of resolved.skinnedModels) {
    let ids = wanted.get(fileId);
    if (!ids) wanted.set(fileId, (ids = new Set()));
    ids.add(group * 100 + variant);
  }
  for (const [fileId, ids] of wanted) {
    const extra = await readModel(fileId, 'An appearance model');
    if (!extra) continue;
    const visible = extra.skin.sections.map((section) => ids.has(section.id));
    if (!visible.some(Boolean)) continue;
    meshes.push(await buildMesh(extra.model, extra.skin, visible, wornBones(extra.model, model, bones)));
  }

  // Item models: mounted on an attachment point (helm, shoulders, weapons, buckles) or
  // worn, skinned to the body's bones (newer armour pieces).
  for (const [slot, look] of worn) {
    for (const itemModel of look.models) {
      const name = look.item.name;
      const loaded = await readModel(itemModel.fileId, 'Its model');
      if (!loaded) continue;
      let attachmentId: number | undefined;
      if (slot === 'head') attachmentId = ATTACH.helm;
      else if (slot === 'shoulder') attachmentId = itemModel.index === 0 ? ATTACH.leftShoulder : ATTACH.rightShoulder;
      else if (slot === 'mainHand') attachmentId = look.bow ? ATTACH.leftHand : ATTACH.rightHand;
      else if (slot === 'offHand') attachmentId = look.shield ? ATTACH.shield : ATTACH.leftHand;
      else if (!skinnedTo(loaded.model, model)) {
        if (slot === 'waist') attachmentId = ATTACH.buckle;
        else if (slot === 'back') attachmentId = ATTACH.back;
      }

      if (attachmentId !== undefined) {
        const transform = attachmentMatrix(model, bones, attachmentId);
        if (!transform) {
          problems.push(`${name}: this model has no place to attach it (point ${attachmentId})`);
          continue;
        }
        const own = poseBones(loaded.model, findSequence(loaded.model.sequences, ANIMATION_STAND), 0);
        const all = loaded.skin.sections.map(() => true);
        meshes.push(await buildMesh(loaded.model, loaded.skin, all, own, transform, name, itemModel.textures));
        continue;
      }

      // Worn: show the geosets the item names for its slot; if it names none the model has, show it whole.
      const ids = new Set(SLOT_GEOSETS[slot].map(([index, group]) => group * 100 + 1 + (look.attachmentGeosetGroup[index] ?? 0)));
      let visible = loaded.skin.sections.map((section) => ids.has(section.id));
      if (!visible.some(Boolean)) visible = visible.map(() => true);
      meshes.push(
        await buildMesh(loaded.model, loaded.skin, visible, wornBones(loaded.model, model, bones), identity(), name, itemModel.textures),
      );
    }
  }

  return { meshes, textures, bounds: { min, max }, problems, options, choices: [...choices] };
}

/** Grow a box to include the vertices of the visible sections after posing. */
function growBounds(
  min: [number, number, number],
  max: [number, number, number],
  vertices: Uint8Array,
  skin: Skin,
  visible: boolean[],
  bones: Float32Array,
  transform: Float32Array,
): void {
  const dv = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
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
      const px = total > 0 ? posed[0]! / total : x;
      const py = total > 0 ? posed[1]! / total : y;
      const pz = total > 0 ? posed[2]! / total : z;
      for (let c = 0; c < 3; c++) {
        const value = transform[c]! * px + transform[4 + c]! * py + transform[8 + c]! * pz + transform[12 + c]!;
        if (value < min[c]!) min[c] = value;
        if (value > max[c]!) max[c] = value;
      }
    }
  });
}
