import type { CascStorage } from '../casc/storage';
import type { SceneDraw, SceneMesh, SceneTexture } from '../character/scene';
import { parseTileObjects, parseWdt, tileOf, TILES } from '../formats/adt';
import { decodeBlp } from '../formats/blp';
import { BONE_BILLBOARD, type M2Model, parseM2, VERTEX_SIZE } from '../formats/m2';
import { parseSkin } from '../formats/skin';
import { GROUP_EXTERIOR, GROUP_INTERIOR, parseWmoGroup, parseWmoRoot, type WmoGroup } from '../formats/wmo';
import { chain, identity, invert, multiply, pivotTransform, rotation, transformPoint, translation } from '../math/mat4';
import { findSequence, poseBones } from '../model/pose';
import { placementMatrix } from './placement';

/*
 * A place: the part of the game world around a spot, as plain data the renderer can draw
 * behind and under a character standing on that spot.
 */

/** Where to stand: world coordinates in yards (x north, y west), as the game reports them. */
export interface Spot {
  /** The map's tile list file (Map table, WdtFileDataID). */
  wdtFileId: number;
  x: number;
  y: number;
  /** Height of the feet, to pick between floors; without it, the highest surface. */
  z?: number;
  /** The way the character faces, in radians anticlockwise from north. */
  facing: number;
  /** How far the world is drawn, in yards. */
  reach: number;
}

/** Bytes of one vertex: position, normal, texture coordinate as floats, then baked light as four bytes. */
export const PLACE_VERTEX_SIZE = 36;

export interface PlaceDraw {
  indexStart: number;
  indexCount: number;
  /** Index into the place's textures, or -1. */
  texture: number;
  /** 0 opaque, 1 cut out where the texture is see-through, 2 and up blended. */
  blendMode: number;
  twoSided: boolean;
  unlit: boolean;
}

export interface PlaceMesh {
  vertices: Uint8Array;
  indices: Uint16Array;
  /** Lit by the sun and sky; otherwise by its baked light, if it has any. */
  outdoors: boolean;
  baked: boolean;
  /** From the mesh's space to the character's. */
  transform: Float32Array;
  draws: PlaceDraw[];
}

export interface PlaceScene {
  meshes: PlaceMesh[];
  textures: SceneTexture[];
  /**
   * The props standing in the place: each model once, in its standing pose, with its own
   * textures, and where every copy of it stands in the character's space (the character is
   * at the origin, facing +X, Z up).
   */
  props: SceneMesh[];
  propTextures: SceneTexture[];
  instances: { prop: number; transform: Float32Array }[];
  reach: number;
  /** Where the feet are in the world. */
  ground: [number, number, number];
  problems: string[];
}

/** Height of the surface under a point of a building, in its own space: the highest, or the highest not above `below`. */
function surfaceUnder(groups: WmoGroup[], x: number, y: number, below = Infinity): { height: number; group: WmoGroup } | undefined {
  let best: { height: number; group: WmoGroup } | undefined;
  for (const group of groups) {
    if (x < group.bounds.min[0] || x > group.bounds.max[0] || y < group.bounds.min[1] || y > group.bounds.max[1]) continue;
    const p = group.positions;
    for (let i = 0; i + 2 < group.indices.length; i += 3) {
      const a = group.indices[i]! * 3;
      const b = group.indices[i + 1]! * 3;
      const c = group.indices[i + 2]! * 3;
      // Where the point is in the triangle seen from above.
      const d = (p[b + 1]! - p[c + 1]!) * (p[a]! - p[c]!) + (p[c]! - p[b]!) * (p[a + 1]! - p[c + 1]!);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((p[b + 1]! - p[c + 1]!) * (x - p[c]!) + (p[c]! - p[b]!) * (y - p[c + 1]!)) / d;
      const v = ((p[c + 1]! - p[a + 1]!) * (x - p[c]!) + (p[a]! - p[c]!) * (y - p[c + 1]!)) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const z = u * p[a + 2]! + v * p[b + 2]! + (1 - u - v) * p[c + 2]!;
      if (z <= below && (best === undefined || z > best.height)) best = { height: z, group };
    }
  }
  return best;
}

/** Halve a picture until neither side is over a limit: far-off walls do not need every texel. */
function shrink(image: SceneTexture, limit: number): SceneTexture {
  let { width, height, pixels } = image;
  while (Math.max(width, height) > limit && width % 2 === 0 && height % 2 === 0) {
    const w = width / 2;
    const h = height / 2;
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const from = (y * 2 * width + x * 2) * 4;
        for (let c = 0; c < 4; c++) {
          out[(y * w + x) * 4 + c] = (pixels[from + c]! + pixels[from + 4 + c]! + pixels[from + width * 4 + c]! + pixels[from + width * 4 + 4 + c]! + 2) >> 2;
        }
      }
    }
    width = w;
    height = h;
    pixels = out;
  }
  return { ...image, width, height, pixels };
}

const ANIMATION_STAND = 0;

/** How far off a room is still drawn when the character stands outdoors, in yards. */
const ROOMS_REACH = 80;

const outdoors = (group: WmoGroup) => (group.flags & GROUP_EXTERIOR) !== 0 && (group.flags & GROUP_INTERIOR) === 0;

/** The prop models of a place: each file read once, however many copies of it stand around. */
class PropLibrary {
  readonly models: SceneMesh[] = [];
  readonly textures: SceneTexture[] = [];
  readonly instances: { prop: number; transform: Float32Array }[] = [];
  private readonly modelOf = new Map<number, number>();
  private readonly textureOf = new Map<string, number>();
  private unreadable = 0;

  constructor(
    private readonly storage: CascStorage,
    private readonly problems: string[],
  ) {}

  /** Stand a copy of a model somewhere. A model that cannot be read is left out and counted. */
  async place(fileId: number, transform: Float32Array): Promise<void> {
    let prop = this.modelOf.get(fileId);
    if (prop === undefined) {
      try {
        prop = this.models.push(await this.read(fileId)) - 1;
      } catch {
        prop = -1;
        this.unreadable++;
      }
      this.modelOf.set(fileId, prop);
    }
    if (prop >= 0) this.instances.push({ prop, transform });
  }

  /** Say how many kinds of prop could not be read. */
  report(): void {
    if (this.unreadable > 0) this.problems.push(`${this.unreadable} kinds of prop in the place could not be read and are left out`);
  }

  private async read(fileId: number): Promise<SceneMesh> {
    const file = await this.storage.readFile(fileId);
    if (!file) throw new Error('not on disk');
    const model = parseM2(file.data);
    if (model.skeletonFileId !== 0) throw new Error('skeleton in a separate file');
    const skinFile = await this.storage.readFile(model.skinFileIds[0] ?? 0);
    if (!skinFile) throw new Error('no skin');
    const skin = parseSkin(skinFile.data);

    const draws: SceneDraw[] = [];
    for (const batch of skin.batches) {
      const section = skin.sections[batch.sectionIndex];
      if (!section) continue;
      const material = model.materials[batch.materialIndex];
      const textures: number[] = [];
      for (let stage = 0; stage < Math.min(batch.textureCount, 4); stage++) {
        textures.push(await this.texture(model, model.textureCombos[batch.textureComboIndex + stage]));
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
        textures,
      });
    }
    let vertexCount = 0;
    for (const v of skin.vertexLookup) if (v >= vertexCount) vertexCount = v + 1;
    const indices = new Uint16Array(skin.indices.length);
    for (let i = 0; i < indices.length; i++) indices[i] = skin.vertexLookup[skin.indices[i]!]!;
    return {
      vertices: model.vertices.slice(0, vertexCount * VERTEX_SIZE),
      indices,
      // Props stand still, at the first moment of their Stand.
      bones: poseBones(model, findSequence(model.sequences, ANIMATION_STAND), 0),
      transform: identity(),
      billboards: model.bones.flatMap((bone, index) => (bone.flags & BONE_BILLBOARD ? [{ bone: index, pivot: bone.pivot }] : [])),
      draws,
    };
  }

  private async texture(model: M2Model, modelTexture: number | undefined): Promise<number> {
    const texture = modelTexture === undefined ? undefined : model.textures[modelTexture];
    if (!texture || texture.type !== 0 || !texture.fileId) return -1;
    const key = `${texture.fileId}:${texture.flags & 3}`;
    const known = this.textureOf.get(key);
    if (known !== undefined) return known;
    let index = -1;
    try {
      const file = await this.storage.readFile(texture.fileId);
      if (file) index = this.textures.push(shrink({ ...decodeBlp(file.data), wrapX: (texture.flags & 1) !== 0, wrapY: (texture.flags & 2) !== 0 }, 256)) - 1;
    } catch {
      // Drawn untextured.
    }
    this.textureOf.set(key, index);
    return index;
  }
}

/** Read the world around a spot. Today that is the building the spot is in or on: a city is one building. */
export async function buildPlace(storage: CascStorage, spot: Spot): Promise<PlaceScene> {
  const problems: string[] = [];
  const read = async (fileId: number, what: string) => {
    const file = fileId ? await storage.readFile(fileId) : undefined;
    if (!file) throw new Error(`${what} is not on disk (file ${fileId})`);
    return file.data;
  };
  const tiles = parseWdt(await read(spot.wdtFileId, 'The map'));
  const { tileX, tileY } = tileOf(spot.x, spot.y);
  const tile = tiles[tileY * TILES + tileX];
  if (!tile) throw new Error('The map has nothing at that spot');
  const { buildings } = parseTileObjects(await read(tile.objects, 'The map tile'));

  // The building whose floor is under the spot.
  let found:
    | { world: Float32Array; local: [number, number, number]; groups: WmoGroup[]; root: ReturnType<typeof parseWmoRoot>; height: number; indoors: boolean; doodadSet: number }
    | undefined;
  for (const building of buildings) {
    const root = parseWmoRoot(await read(building.fileId, 'A building'));
    const world = placementMatrix(building);
    const local = transformPoint(invert(new Float32Array(16), world), [spot.x, spot.y, spot.z ?? 0]);
    const groups: WmoGroup[] = [];
    for (const id of root.groupFileIds) groups.push(parseWmoGroup(await read(id, 'Part of a building')));
    const surface = surfaceUnder(groups, local[0], local[1], spot.z === undefined ? Infinity : local[2] + 2.5);
    if (surface) {
      found = { world, local, groups, root, height: surface.height, indoors: !outdoors(surface.group), doodadSet: building.doodadSet };
      break;
    }
  }
  if (!found) throw new Error('No building stands on that spot; open ground is not drawn yet');
  const { world, local, root, height, indoors } = found;

  const ground = transformPoint(world, [local[0], local[1], height]);
  // The character's space: its feet on the ground at the spot, facing the way it was told.
  const character = chain(translation(ground[0], ground[1], ground[2]), rotation('z', spot.facing));
  const toCharacter = multiply(new Float32Array(16), invert(new Float32Array(16), character), world);

  // Only the parts within reach of the spot.
  // Seen from outdoors, rooms far off are left out: the game hides them behind their doorways,
  // and without that they show through walls that only face inward.
  const near = found.groups.filter((group) => {
    const { bounds } = group;
    let d = 0;
    for (let c = 0; c < 3; c++) {
      const p = c === 2 ? height : local[c]!;
      const gap = Math.max(bounds.min[c]! - p, 0, p - bounds.max[c]!);
      d += gap * gap;
    }
    const reach = indoors || outdoors(group) ? spot.reach : Math.min(spot.reach, ROOMS_REACH);
    return d <= reach * reach;
  });

  const textures: SceneTexture[] = [];
  const textureIndex = new Map<string, number>();
  const textureOf = async (fileId: number, clampS: boolean, clampT: boolean): Promise<number> => {
    if (!fileId) return -1;
    const key = `${fileId}:${clampS}:${clampT}`;
    const known = textureIndex.get(key);
    if (known !== undefined) return known;
    let index = -1;
    try {
      const file = await storage.readFile(fileId);
      if (!file) throw new Error('not on disk');
      index = textures.push(shrink({ ...decodeBlp(file.data), wrapX: !clampS, wrapY: !clampT }, 512)) - 1;
    } catch (cause) {
      problems.push(`A texture of the place could not be read (file ${fileId}): ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    textureIndex.set(key, index);
    return index;
  };

  const meshes: PlaceMesh[] = [];
  for (const group of near) {
    const count = group.positions.length / 3;
    if (count === 0 || group.batches.length === 0) continue;
    const vertices = new Uint8Array(count * PLACE_VERTEX_SIZE);
    const dv = new DataView(vertices.buffer);
    for (let i = 0; i < count; i++) {
      const at = i * PLACE_VERTEX_SIZE;
      for (let c = 0; c < 3; c++) {
        dv.setFloat32(at + c * 4, group.positions[i * 3 + c]!, true);
        dv.setFloat32(at + 12 + c * 4, group.normals[i * 3 + c] ?? 0, true);
      }
      dv.setFloat32(at + 24, group.uvs[i * 2] ?? 0, true);
      dv.setFloat32(at + 28, group.uvs[i * 2 + 1] ?? 0, true);
      // Stored blue first; the renderer wants red first.
      const colour = group.colours;
      vertices[at + 32] = colour ? colour[i * 4 + 2]! : 0;
      vertices[at + 33] = colour ? colour[i * 4 + 1]! : 0;
      vertices[at + 34] = colour ? colour[i * 4]! : 0;
      vertices[at + 35] = colour ? colour[i * 4 + 3]! : 255;
    }
    const draws: PlaceDraw[] = [];
    for (const batch of group.batches) {
      const material = root.materials[batch.material];
      if (!material || batch.indexCount === 0) continue;
      draws.push({
        indexStart: batch.indexStart,
        indexCount: batch.indexCount,
        texture: await textureOf(material.textures[0], (material.flags & 0x40) !== 0, (material.flags & 0x80) !== 0),
        blendMode: material.blendMode,
        twoSided: (material.flags & 0x4) !== 0,
        unlit: (material.flags & 0x1) !== 0,
      });
    }
    meshes.push({
      vertices,
      indices: group.indices,
      outdoors: outdoors(group),
      baked: group.colours !== undefined,
      transform: toCharacter,
      draws,
    });
  }

  // The props of the parts drawn: the building's standing set, and the set this placement adds.
  const sets = [root.doodadSets[0], found.doodadSet > 0 ? root.doodadSets[found.doodadSet] : undefined];
  const inSet = (index: number) => sets.some((set) => set && index >= set.start && index < set.start + set.count);
  const props = new PropLibrary(storage, problems);
  const placed = new Set<number>();
  for (const group of near) {
    for (const index of group.doodadRefs) {
      const doodad = root.doodads[index];
      if (!doodad || placed.has(index) || !inSet(index)) continue;
      placed.add(index);
      if (Math.hypot(doodad.position[0] - local[0], doodad.position[1] - local[1], doodad.position[2] - height) > spot.reach) continue;
      const own = pivotTransform(new Float32Array(16), [0, 0, 0], doodad.position, doodad.rotation, [doodad.scale, doodad.scale, doodad.scale]);
      await props.place(doodad.fileId, multiply(new Float32Array(16), toCharacter, own));
    }
  }
  props.report();

  return { meshes, textures, props: props.models, propTextures: props.textures, instances: props.instances, reach: spot.reach, ground, problems };
}
