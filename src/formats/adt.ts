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
        buildings.push({ ...common(at), scale, doodadSet: dv.getUint16(at + 58, true) });
      }
    }
  }
  return { doodads, buildings };
}
