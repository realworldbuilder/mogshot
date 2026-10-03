import { readChunks } from './chunks';

/*
 * The outdoor world: a map is a 64 x 64 grid of tiles, each 533⅓ yards square. The map's
 * WDT file lists the files of every tile; a tile's object file lists the buildings and
 * props standing on it. Layouts follow wowdev.wiki (WDT, ADT/v18).
 */

export const TILE_SIZE = 1600 / 3;
/** Tiles along one side of a map. The world's origin is at the middle of the grid. */
export const TILES = 64;
/** Half the width of a map: where the placement coordinates start from. */
export const MAP_HALF = (TILES / 2) * TILE_SIZE;

export interface TileFiles {
  root: number;
  objects: number;
  textures: number;
}

/** The files of each tile of a map, by `tileY * 64 + tileX`; undefined where the map has no tile. */
export function parseWdt(bytes: Uint8Array): (TileFiles | undefined)[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const maid = readChunks(bytes).find((c) => c.id === 'MAID');
  if (!maid) throw new Error('This map lists no tile files');
  return Array.from({ length: TILES * TILES }, (_, i) => {
    const at = maid.at + i * 32;
    const root = dv.getUint32(at, true);
    return root ? { root, objects: dv.getUint32(at + 4, true), textures: dv.getUint32(at + 12, true) } : undefined;
  });
}

/** The tile a world position is on. */
export function tileOf(x: number, y: number): { tileX: number; tileY: number } {
  return { tileX: Math.floor((MAP_HALF - y) / TILE_SIZE), tileY: Math.floor((MAP_HALF - x) / TILE_SIZE) };
}

/** Something standing on a tile, as the tile records it: in placement space, where Y is up. */
export interface Placement {
  fileId: number;
  uniqueId: number;
  position: [number, number, number];
  /** Degrees. */
  rotation: [number, number, number];
  scale: number;
  /** For a building, which set of its props is shown. */
  doodadSet: number;
  /** For a building, the box around it in world coordinates. */
  extents?: { min: [number, number, number]; max: [number, number, number] };
}

const BY_FILE_ID_DOODAD = 0x40;
const BY_FILE_ID_BUILDING = 0x8;

/** The props and buildings a tile's object file places. Entries that name a file by path are skipped: this build has none. */
export function parseTileObjects(bytes: Uint8Array): { doodads: Placement[]; buildings: Placement[] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = readChunks(bytes);
  const f = (at: number) => dv.getFloat32(at, true);
  const common = (at: number) => ({
    fileId: dv.getUint32(at, true),
    uniqueId: dv.getUint32(at + 4, true),
    position: [f(at + 8), f(at + 12), f(at + 16)] as [number, number, number],
    rotation: [f(at + 20), f(at + 24), f(at + 28)] as [number, number, number],
  });
  const doodads: Placement[] = [];
  const buildings: Placement[] = [];
  for (const chunk of chunks) {
    if (chunk.id === 'MDDF') {
      for (let at = chunk.at; at + 36 <= chunk.at + chunk.size; at += 36) {
        if ((dv.getUint16(at + 34, true) & BY_FILE_ID_DOODAD) === 0) continue;
        doodads.push({ ...common(at), scale: dv.getUint16(at + 32, true) / 1024, doodadSet: 0 });
      }
    } else if (chunk.id === 'MODF') {
      for (let at = chunk.at; at + 64 <= chunk.at + chunk.size; at += 64) {
        const flags = dv.getUint16(at + 56, true);
        if ((flags & BY_FILE_ID_BUILDING) === 0) continue;
        // The scale field is only meaningful when its flag is set.
        const scale = flags & 0x4 ? dv.getUint16(at + 62, true) / 1024 : 1;
        // The box is stored in placement space: across, up, along, measured from the map's corner.
        const a = [f(at + 32), f(at + 36), f(at + 40)] as const;
        const b = [f(at + 44), f(at + 48), f(at + 52)] as const;
        const extents: Placement['extents'] = {
          min: [MAP_HALF - Math.max(a[2], b[2]), MAP_HALF - Math.max(a[0], b[0]), Math.min(a[1], b[1])],
          max: [MAP_HALF - Math.min(a[2], b[2]), MAP_HALF - Math.min(a[0], b[0]), Math.max(a[1], b[1])],
        };
        buildings.push({ ...common(at), scale, doodadSet: dv.getUint16(at + 58, true), extents });
      }
    }
  }
  return { doodads, buildings };
}

/** Chunks along one side of a tile, and their size in yards. */
export const CHUNKS = 16;
export const CHUNK_SIZE = TILE_SIZE / CHUNKS;
/** Height samples of a chunk: 9 rows of 9 with 8 rows of 8 between them. */
export const CHUNK_HEIGHTS = 145;
/** Texels along one side of a chunk's blend map. */
export const BLEND_SIZE = 64;

/** One sixteenth of a tile's ground. */
export interface TerrainChunk {
  /** The world position of its north-west corner (largest x and y) and the height its samples are measured from. */
  x: number;
  y: number;
  z: number;
  /** Heights above `z`: rows run south (x falling), samples in a row run east (y falling). */
  heights: Float32Array;
  /** Tint per height sample as B, G, R, A bytes where 127 is no change, if the chunk has one. */
  tint: Uint8Array | undefined;
  /** Cells of the 8 x 8 grid that are cut out, as bits: row * 8 + column. */
  holes: bigint;
}

/** The ground of a tile: 256 chunks, row by row from the north-west. */
export function parseTerrain(bytes: Uint8Array): TerrainChunk[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: TerrainChunk[] = [];
  for (const mcnk of readChunks(bytes)) {
    if (mcnk.id !== 'MCNK') continue;
    const flags = dv.getUint32(mcnk.at, true);
    let holes = 0n;
    if (flags & 0x10000) holes = dv.getBigUint64(mcnk.at + 0x14, true);
    else {
      // The older, coarser holes: each bit cuts a 2 x 2 block of cells.
      const low = dv.getUint16(mcnk.at + 0x3c, true);
      for (let bit = 0; bit < 16; bit++) {
        if (((low >> bit) & 1) === 0) continue;
        const row = (bit >> 2) * 2;
        const column = (bit & 3) * 2;
        for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) holes |= 1n << BigInt((row + r) * 8 + column + c);
      }
    }
    const inner = readChunks(bytes, mcnk.at + 128, mcnk.at + mcnk.size);
    const mcvt = inner.find((c) => c.id === 'MCVT');
    if (!mcvt || mcvt.size < CHUNK_HEIGHTS * 4) continue;
    const mccv = inner.find((c) => c.id === 'MCCV');
    chunks.push({
      x: dv.getFloat32(mcnk.at + 0x68, true),
      y: dv.getFloat32(mcnk.at + 0x6c, true),
      z: dv.getFloat32(mcnk.at + 0x70, true),
      heights: new Float32Array(bytes.slice(mcvt.at, mcvt.at + CHUNK_HEIGHTS * 4).buffer),
      tint: mccv && mccv.size >= CHUNK_HEIGHTS * 4 ? bytes.slice(mccv.at, mccv.at + CHUNK_HEIGHTS * 4) : undefined,
      holes,
    });
  }
  return chunks;
}

/** What a chunk of ground is painted with: up to four textures, each after the first spread by a blend map. */
export interface ChunkLayer {
  textureFileId: number;
  /** 64 x 64 coverage, rows from the north; undefined for the base layer, which covers everything. */
  blend: Uint8Array | undefined;
}

/** The paint of a tile's 256 chunks, from its texture file. `bigAlpha` is the map's setting for how blend maps are stored. */
export function parseTerrainLayers(bytes: Uint8Array, bigAlpha: boolean): ChunkLayer[][] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = readChunks(bytes);
  const ids = top.find((c) => c.id === 'MDID');
  const fileIdOf = (index: number) => (ids && index * 4 < ids.size ? dv.getUint32(ids.at + index * 4, true) : 0);
  const result: ChunkLayer[][] = [];
  for (const mcnk of top) {
    if (mcnk.id !== 'MCNK') continue;
    const inner = readChunks(bytes, mcnk.at, mcnk.at + mcnk.size);
    const mcly = inner.find((c) => c.id === 'MCLY');
    const mcal = inner.find((c) => c.id === 'MCAL');
    const layers: ChunkLayer[] = [];
    for (let at = mcly?.at ?? 0, end = at + (mcly?.size ?? 0); at + 16 <= end; at += 16) {
      const flags = dv.getUint32(at + 4, true);
      let blend: Uint8Array | undefined;
      if (flags & 0x100 && mcal) {
        blend = new Uint8Array(BLEND_SIZE * BLEND_SIZE);
        let from = mcal.at + dv.getUint32(at + 8, true);
        if (flags & 0x200) {
          // Run-length packed: a count byte whose top bit says "repeat the next byte".
          let to = 0;
          while (to < blend.length && from < mcal.at + mcal.size) {
            const head = bytes[from++]!;
            const count = head & 0x7f;
            if (head & 0x80) blend.fill(bytes[from++]!, to, to + count);
            else blend.set(bytes.subarray(from, (from += count)).subarray(0, blend.length - to), to);
            to += count;
          }
        } else if (bigAlpha) {
          blend.set(bytes.subarray(from, from + blend.length));
        } else {
          // Four bits a texel, 2048 bytes.
          for (let i = 0; i < blend.length; i++) {
            const nibble = (bytes[from + (i >> 1)]! >> ((i & 1) * 4)) & 0xf;
            blend[i] = nibble * 17;
          }
        }
      }
      layers.push({ textureFileId: fileIdOf(dv.getUint32(at, true)), blend });
    }
    result.push(layers);
  }
  return result;
}

/** A sheet of water over part of a chunk. */
export interface WaterSheet {
  /** Index of the chunk in the tile. */
  chunk: number;
  height: number;
  /** The part of the chunk's 8 x 8 cells it covers. */
  column: number;
  row: number;
  width: number;
  depth: number;
  /** Which of its cells have water, as bits (row * width + column), or undefined for all. */
  cells: bigint | undefined;
}

/** The water of a tile, from its root file. Heights that vary across a sheet are flattened to its lowest. */
export function parseWater(bytes: Uint8Array): WaterSheet[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mh2o = readChunks(bytes).find((c) => c.id === 'MH2O');
  const sheets: WaterSheet[] = [];
  if (!mh2o) return sheets;
  for (let chunk = 0; chunk < CHUNKS * CHUNKS; chunk++) {
    const head = mh2o.at + chunk * 12;
    const count = dv.getUint32(head + 4, true);
    for (let layer = 0; layer < count; layer++) {
      const at = mh2o.at + dv.getUint32(head, true) + layer * 24;
      const width = bytes[at + 14]!;
      const depth = bytes[at + 15]!;
      const bitmap = dv.getUint32(at + 16, true);
      let cells: bigint | undefined;
      if (bitmap) {
        cells = 0n;
        for (let i = 0; i < Math.ceil((width * depth) / 8); i++) cells |= BigInt(bytes[mh2o.at + bitmap + i]!) << BigInt(i * 8);
      }
      sheets.push({ chunk, height: dv.getFloat32(at + 4, true), column: bytes[at + 12]!, row: bytes[at + 13]!, width, depth, cells });
    }
  }
  return sheets;
}

/** Whether a map stores its blend maps a byte to the texel (WDT header flags 0x4 and 0x80). */
export function mapHasBigAlpha(wdt: Uint8Array): boolean {
  const mphd = readChunks(wdt).find((c) => c.id === 'MPHD');
  return mphd !== undefined && (new DataView(wdt.buffer, wdt.byteOffset, wdt.byteLength).getUint32(mphd.at, true) & 0x84) !== 0;
}
