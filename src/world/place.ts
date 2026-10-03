import type { CascStorage } from '../casc/storage';
import type { SceneDraw, SceneMesh, SceneTexture } from '../character/scene';
import {
  BLEND_SIZE, CHUNK_SIZE, CHUNKS, mapHasBigAlpha, parseTerrain, parseTerrainLayers, parseTileObjects, parseWater, parseWdt,
  type Placement, type TerrainChunk, tileOf, TILES,
} from '../formats/adt';
import { decodeBlp, type Image } from '../formats/blp';
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
  /** A sheet of water: drawn in the water's colour, not a texture's. */
  water?: boolean;
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

/** The ground of one map tile, as much of it as is within reach. Vertices are laid out as a PlaceMesh's. */
export interface TerrainMesh {
  vertices: Uint8Array;
  indices: Uint16Array;
  /** How far each chunk's second, third and fourth textures cover it (red, green, blue): 16 x 16 chunks of 64 x 64 texels. */
  blend: Image;
  transform: Float32Array;
  draws: {
    indexStart: number;
    indexCount: number;
    /** The chunk's place in the tile, for finding its part of the blend picture. */
    column: number;
    row: number;
    /** Up to four textures, the first covering everything; indices into the place's textures. */
    layers: number[];
  }[];
}

export interface PlaceScene {
  terrain: TerrainMesh[];
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

/** The floors under a point of a building, in its own space: every surface there that faces up. */
function floorsUnder(groups: WmoGroup[], x: number, y: number): { height: number; group: WmoGroup }[] {
  const floors: { height: number; group: WmoGroup }[] = [];
  for (const group of groups) {
    if (x < group.bounds.min[0] || x > group.bounds.max[0] || y < group.bounds.min[1] || y > group.bounds.max[1]) continue;
    const p = group.positions;
    const n = group.normals;
    for (let i = 0; i + 2 < group.indices.length; i += 3) {
      const ia = group.indices[i]!;
      const ib = group.indices[i + 1]!;
      const ic = group.indices[i + 2]!;
      // Ceilings and the undersides of bridges are not floors.
      if ((n[ia * 3 + 2] ?? 0) + (n[ib * 3 + 2] ?? 0) + (n[ic * 3 + 2] ?? 0) < 1.5) continue;
      const a = ia * 3;
      const b = ib * 3;
      const c = ic * 3;
      // Where the point is in the triangle seen from above.
      const d = (p[b + 1]! - p[c + 1]!) * (p[a]! - p[c]!) + (p[c]! - p[b]!) * (p[a + 1]! - p[c + 1]!);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((p[b + 1]! - p[c + 1]!) * (x - p[c]!) + (p[c]! - p[b]!) * (y - p[c + 1]!)) / d;
      const v = ((p[c + 1]! - p[a + 1]!) * (x - p[c]!) + (p[a]! - p[c]!) * (y - p[c + 1]!)) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      floors.push({ height: u * p[a + 2]! + v * p[b + 2]! + (1 - u - v) * p[c + 2]!, group });
    }
  }
  return floors;
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

/** Yards between neighbouring height samples of the ground. */
const UNIT = CHUNK_SIZE / 8;
/** Index of a chunk's height sample: the corner rows hold 9, the rows of cell centres between them 8. */
const corner = (row: number, column: number) => row * 17 + column;
const centre = (row: number, column: number) => row * 17 + 9 + column;

/** Height of the ground at a world position in a tile's chunks, or undefined where there is none (off the tile, or a hole). */
function terrainHeight(chunks: readonly TerrainChunk[], x: number, y: number): number | undefined {
  for (const chunk of chunks) {
    const r = (chunk.x - x) / UNIT;
    const c = (chunk.y - y) / UNIT;
    if (r < 0 || r >= 8 || c < 0 || c >= 8) continue;
    const row = Math.floor(r);
    const column = Math.floor(c);
    if ((chunk.holes >> BigInt(row * 8 + column)) & 1n) return undefined;
    const fr = r - row;
    const fc = c - column;
    const h = chunk.heights;
    // Each cell is four triangles meeting at its centre sample.
    const middle = h[centre(row, column)]!;
    const [a, b, along, across] =
      fr <= fc && fr <= 1 - fc
        ? [h[corner(row, column)]!, h[corner(row, column + 1)]!, fc, fr] // north
        : fr >= fc && fr >= 1 - fc
          ? [h[corner(row + 1, column)]!, h[corner(row + 1, column + 1)]!, fc, 1 - fr] // south
          : fc < 0.5
            ? [h[corner(row, column)]!, h[corner(row + 1, column)]!, fr, fc] // west
            : [h[corner(row, column + 1)]!, h[corner(row + 1, column + 1)]!, fr, 1 - fc]; // east
    // `across` runs 0 at the edge to 0.5 at the centre; `along` runs along the edge.
    const t = across * 2;
    const edge = t >= 1 ? 0 : (along - across) / (1 - t);
    return chunk.z + (a + (b - a) * edge) * (1 - t) + middle * t;
  }
  return undefined;
}

function writeVertex(dv: DataView, at: number, position: readonly number[], normal: readonly number[], u: number, v: number, colour: readonly number[]): void {
  for (let c = 0; c < 3; c++) {
    dv.setFloat32(at + c * 4, position[c]!, true);
    dv.setFloat32(at + 12 + c * 4, normal[c]!, true);
  }
  dv.setFloat32(at + 24, u, true);
  dv.setFloat32(at + 28, v, true);
  for (let c = 0; c < 4; c++) dv.setUint8(at + 32 + c, colour[c]!);
}

/** Read the world around a spot: the ground, the water, the buildings and the props within reach. */
export async function buildPlace(storage: CascStorage, spot: Spot): Promise<PlaceScene> {
  const problems: string[] = [];
  const read = async (fileId: number, what: string) => {
    const file = fileId ? await storage.readFile(fileId) : undefined;
    if (!file) throw new Error(`${what} is not on disk (file ${fileId})`);
    return file.data;
  };
  const wdt = await read(spot.wdtFileId, 'The map');
  const tiles = parseWdt(wdt);
  const bigAlpha = mapHasBigAlpha(wdt);

  // The tiles within reach, with their ground and what stands on them.
  const first = tileOf(spot.x + spot.reach, spot.y + spot.reach);
  const last = tileOf(spot.x - spot.reach, spot.y - spot.reach);
  const loaded: { files: NonNullable<(typeof tiles)[number]>; root: Uint8Array; chunks: TerrainChunk[] }[] = [];
  const buildings = new Map<number, Placement>();
  const standing = new Map<number, Placement>();
  for (let tileY = Math.max(0, first.tileY); tileY <= Math.min(TILES - 1, last.tileY); tileY++) {
    for (let tileX = Math.max(0, first.tileX); tileX <= Math.min(TILES - 1, last.tileX); tileX++) {
      const files = tiles[tileY * TILES + tileX];
      if (!files) continue;
      const root = await read(files.root, 'A map tile');
      loaded.push({ files, root, chunks: parseTerrain(root) });
      const objects = parseTileObjects(await read(files.objects, "A map tile's objects"));
      // Something that spans tiles is listed on each of them.
      for (const building of objects.buildings) buildings.set(building.uniqueId, building);
      for (const doodad of objects.doodads) standing.set(doodad.uniqueId, doodad);
    }
  }
  if (loaded.length === 0) throw new Error('The map has nothing at that spot');

  // Buildings near enough to be seen, and the floor each offers under the spot.
  const near: { building: Placement; world: Float32Array; root: ReturnType<typeof parseWmoRoot>; groups: WmoGroup[] }[] = [];
  const floors: { height: number; indoors: boolean }[] = [];
  for (const building of buildings.values()) {
    const box = building.extents;
    if (box) {
      const dx = Math.max(box.min[0] - spot.x, 0, spot.x - box.max[0]);
      const dy = Math.max(box.min[1] - spot.y, 0, spot.y - box.max[1]);
      if (Math.hypot(dx, dy) > spot.reach) continue;
    }
    try {
      const root = parseWmoRoot(await read(building.fileId, 'A building'));
      const world = placementMatrix(building);
      const local = transformPoint(invert(new Float32Array(16), world), [spot.x, spot.y, spot.z ?? 0]);
      const groups: WmoGroup[] = [];
      for (const id of root.groupFileIds) groups.push(parseWmoGroup(await read(id, 'Part of a building')));
      near.push({ building, world, root, groups });
      for (const floor of floorsUnder(groups, local[0], local[1])) {
        floors.push({ height: transformPoint(world, [local[0], local[1], floor.height])[2], indoors: !outdoors(floor.group) });
      }
    } catch (cause) {
      problems.push(`A building of the place could not be read: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  const earth = terrainHeight(loaded.flatMap((tile) => tile.chunks), spot.x, spot.y);
  // With a height given, the feet go on the highest floor not above it. Without one, on the
  // lowest floor of a building above the earth (the street of a city, the ground floor of a
  // house, not its roof), or on the earth where no building stands.
  let floor: { height: number; indoors: boolean } | undefined;
  if (spot.z !== undefined) {
    const limit = spot.z + 2.5;
    if (earth !== undefined) floors.push({ height: earth, indoors: false });
    floor = floors.filter((f) => f.height <= limit).sort((a, b) => b.height - a.height)[0];
  } else {
    // A floor laid on the earth can sit a little under it.
    floor = floors.filter((f) => earth === undefined || f.height >= earth - 3).sort((a, b) => a.height - b.height)[0];
    if (!floor && earth !== undefined) floor = { height: earth, indoors: false };
  }
  if (!floor) throw new Error('There is no ground at that spot');
  const { indoors } = floor;
  const ground: [number, number, number] = [spot.x, spot.y, floor.height];

  // The character's space: its feet on the ground at the spot, facing the way it was told.
  const character = chain(translation(ground[0], ground[1], ground[2]), rotation('z', spot.facing));
  const fromWorld = invert(new Float32Array(16), character);
  // Ground and water are stored measured from the spot, which keeps their numbers small and exact.
  const fromSpot = rotation('z', -spot.facing);

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

  const terrain: TerrainMesh[] = [];
  const meshes: PlaceMesh[] = [];
  for (const tile of loaded) {
    const within = tile.chunks.map((chunk) => Math.hypot(chunk.x - CHUNK_SIZE / 2 - spot.x, chunk.y - CHUNK_SIZE / 2 - spot.y) <= spot.reach + CHUNK_SIZE);
    if (!within.some(Boolean)) continue;
    const layers = parseTerrainLayers(await read(tile.files.textures, "A map tile's textures"), bigAlpha);

    const vertices = new Uint8Array(tile.chunks.length * 145 * PLACE_VERTEX_SIZE);
    const dv = new DataView(vertices.buffer);
    const indices: number[] = [];
    const blend = new Uint8Array(CHUNKS * BLEND_SIZE * CHUNKS * BLEND_SIZE * 4);
    const draws: TerrainMesh['draws'] = [];
    // The tile's north-west corner, to place each chunk in the blend picture.
    const tileX0 = Math.max(...tile.chunks.map((chunk) => chunk.x));
    const tileY0 = Math.max(...tile.chunks.map((chunk) => chunk.y));
    for (const [index, chunk] of tile.chunks.entries()) {
      if (!within[index]) continue;
      const h = chunk.heights;
      const base = index * 145;
      const outer = (row: number, column: number) => h[corner(Math.min(8, Math.max(0, row)), Math.min(8, Math.max(0, column)))]!;
      const put = (sample: number, row: number, column: number, south: number, east: number) => {
        // Heights fall or rise `south` and `east` per yard; x runs north and y runs west.
        const length = Math.hypot(south, east, 1);
        const tint = chunk.tint;
        writeVertex(
          dv,
          (base + sample) * PLACE_VERTEX_SIZE,
          [chunk.x - row * UNIT - ground[0], chunk.y - column * UNIT - ground[1], chunk.z + h[sample]! - ground[2]],
          [south / length, east / length, 1 / length],
          column / 8,
          row / 8,
          tint ? [tint[sample * 4 + 2]!, tint[sample * 4 + 1]!, tint[sample * 4]!, 255] : [127, 127, 127, 255],
        );
      };
      for (let row = 0; row <= 8; row++) {
        for (let column = 0; column <= 8; column++) {
          const rows = Math.min(8, row + 1) - Math.max(0, row - 1);
          const columns = Math.min(8, column + 1) - Math.max(0, column - 1);
          put(corner(row, column), row, column, (outer(row + 1, column) - outer(row - 1, column)) / (rows * UNIT), (outer(row, column + 1) - outer(row, column - 1)) / (columns * UNIT));
        }
      }
      const start = indices.length;
      for (let row = 0; row < 8; row++) {
        for (let column = 0; column < 8; column++) {
          const south = (outer(row + 1, column) + outer(row + 1, column + 1) - outer(row, column) - outer(row, column + 1)) / (2 * UNIT);
          const east = (outer(row, column + 1) + outer(row + 1, column + 1) - outer(row, column) - outer(row + 1, column)) / (2 * UNIT);
          put(centre(row, column), row + 0.5, column + 0.5, south, east);
          if ((chunk.holes >> BigInt(row * 8 + column)) & 1n) continue;
          const middle = base + centre(row, column);
          const nw = base + corner(row, column);
          const ne = base + corner(row, column + 1);
          const sw = base + corner(row + 1, column);
          const se = base + corner(row + 1, column + 1);
          indices.push(nw, ne, middle, ne, se, middle, se, sw, middle, sw, nw, middle);
        }
      }
      if (indices.length === start) continue;

      const column = Math.round((tileY0 - chunk.y) / CHUNK_SIZE);
      const row = Math.round((tileX0 - chunk.x) / CHUNK_SIZE);
      const painted = (layers[index] ?? []).slice(0, 4);
      const drawn: number[] = [];
      for (const [depth, layer] of painted.entries()) {
        drawn.push(await textureOf(layer.textureFileId, false, false));
        if (depth === 0) continue;
        for (let ty = 0; ty < BLEND_SIZE; ty++) {
          for (let tx = 0; tx < BLEND_SIZE; tx++) {
            const to = ((row * BLEND_SIZE + ty) * CHUNKS * BLEND_SIZE + column * BLEND_SIZE + tx) * 4 + depth - 1;
            blend[to] = layer.blend ? layer.blend[ty * BLEND_SIZE + tx]! : 255;
          }
        }
      }
      draws.push({ indexStart: start, indexCount: indices.length - start, column, row, layers: drawn });
    }
    if (draws.length > 0) {
      terrain.push({
        vertices,
        indices: new Uint16Array(indices),
        blend: { width: CHUNKS * BLEND_SIZE, height: CHUNKS * BLEND_SIZE, pixels: blend },
        transform: fromSpot,
        draws,
      });
    }

    // Water: a flat square for every cell that has it.
    const sheets = parseWater(tile.root).filter((sheet) => within[sheet.chunk]);
    const cells = sheets.reduce((n, sheet) => n + sheet.width * sheet.depth, 0);
    if (cells > 0) {
      const water = new Uint8Array(cells * 4 * PLACE_VERTEX_SIZE);
      const waterView = new DataView(water.buffer);
      const waterIndices: number[] = [];
      let count = 0;
      for (const sheet of sheets) {
        const chunk = tile.chunks[sheet.chunk]!;
        for (let r = 0; r < sheet.depth; r++) {
          for (let c = 0; c < sheet.width; c++) {
            if (sheet.cells !== undefined && ((sheet.cells >> BigInt(r * sheet.width + c)) & 1n) === 0n) continue;
            if (count + 4 > 65536) break;
            for (const [dr, dc] of [[0, 0], [0, 1], [1, 1], [1, 0]] as const) {
              writeVertex(
                waterView,
                count++ * PLACE_VERTEX_SIZE,
                [chunk.x - (sheet.row + r + dr) * UNIT - ground[0], chunk.y - (sheet.column + c + dc) * UNIT - ground[1], sheet.height - ground[2]],
                [0, 0, 1],
                dc,
                dr,
                [0, 0, 0, 255],
              );
            }
            waterIndices.push(count - 4, count - 3, count - 2, count - 4, count - 2, count - 1);
          }
        }
      }
      if (count > 0) {
        meshes.push({
          vertices: water.subarray(0, count * PLACE_VERTEX_SIZE),
          indices: new Uint16Array(waterIndices),
          outdoors: true,
          baked: false,
          transform: fromSpot,
          draws: [{ indexStart: 0, indexCount: waterIndices.length, texture: -1, blendMode: 2, twoSided: true, unlit: false, water: true }],
        });
      }
    }
  }

  const props = new PropLibrary(storage, problems);
  for (const { building, world, root, groups } of near) {
    const toCharacter = multiply(new Float32Array(16), fromWorld, world);
    // The spot at its found height, in the building's space.
    const here = transformPoint(invert(new Float32Array(16), world), ground);
    // Only the parts within reach. Seen from outdoors, rooms far off are left out: the game hides
    // them behind their doorways, and without that they show through walls that only face inward.
    const parts = groups.filter((group) => {
      let d = 0;
      for (let c = 0; c < 3; c++) {
        const gap = Math.max(group.bounds.min[c]! - here[c]!, 0, here[c]! - group.bounds.max[c]!);
        d += gap * gap;
      }
      const reach = indoors || outdoors(group) ? spot.reach : Math.min(spot.reach, ROOMS_REACH);
      return d <= reach * reach;
    });
    for (const group of parts) {
      const count = group.positions.length / 3;
      if (count === 0 || group.batches.length === 0) continue;
      const vertices = new Uint8Array(count * PLACE_VERTEX_SIZE);
      const dv = new DataView(vertices.buffer);
      const colour = group.colours;
      for (let i = 0; i < count; i++) {
        writeVertex(
          dv,
          i * PLACE_VERTEX_SIZE,
          [group.positions[i * 3]!, group.positions[i * 3 + 1]!, group.positions[i * 3 + 2]!],
          [group.normals[i * 3] ?? 0, group.normals[i * 3 + 1] ?? 0, group.normals[i * 3 + 2] ?? 0],
          group.uvs[i * 2] ?? 0,
          group.uvs[i * 2 + 1] ?? 0,
          // Stored blue first; the renderer wants red first.
          colour ? [colour[i * 4 + 2]!, colour[i * 4 + 1]!, colour[i * 4]!, colour[i * 4 + 3]!] : [0, 0, 0, 255],
        );
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
      meshes.push({ vertices, indices: group.indices, outdoors: outdoors(group), baked: colour !== undefined, transform: toCharacter, draws });
    }

    // The props of the parts drawn: the building's standing set, and the set this placement adds.
    const sets = [root.doodadSets[0], building.doodadSet > 0 ? root.doodadSets[building.doodadSet] : undefined];
    const inSet = (index: number) => sets.some((set) => set && index >= set.start && index < set.start + set.count);
    const placed = new Set<number>();
    for (const group of parts) {
      for (const index of group.doodadRefs) {
        const doodad = root.doodads[index];
        if (!doodad || placed.has(index) || !inSet(index)) continue;
        placed.add(index);
        if (Math.hypot(doodad.position[0] - here[0], doodad.position[1] - here[1], doodad.position[2] - here[2]) > spot.reach) continue;
        const own = pivotTransform(new Float32Array(16), [0, 0, 0], doodad.position, doodad.rotation, [doodad.scale, doodad.scale, doodad.scale]);
        await props.place(doodad.fileId, multiply(new Float32Array(16), toCharacter, own));
      }
    }
  }

  // Props standing on the ground itself: trees, rocks, fences.
  for (const doodad of standing.values()) {
    const world = placementMatrix(doodad);
    if (Math.hypot(world[12]! - spot.x, world[13]! - spot.y) > spot.reach) continue;
    await props.place(doodad.fileId, multiply(new Float32Array(16), fromWorld, world));
  }
  props.report();

  return { terrain, meshes, textures, props: props.models, propTextures: props.textures, instances: props.instances, reach: spot.reach, ground, problems };
}
