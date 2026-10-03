import { readChunks } from './chunks';

/*
 * World map objects: buildings, and whole cities. A root file lists materials, the props
 * placed inside and the files of its groups; each group file holds the geometry of one
 * room or one part of the outside. Layouts follow wowdev.wiki (WMO) and wow.export's
 * loader (MIT, Kruithne and Marlamin).
 */

export interface WmoMaterial {
  /** 0x1 unlit, 0x4 two-sided, 0x10 bright at night (windows), 0x40/0x80 clamp S/T. */
  flags: number;
  shader: number;
  /** As for models: 0 opaque, 1 alpha key, 2 alpha blend, 3 add. */
  blendMode: number;
  /** Texture files; 0 where there is none. */
  textures: [number, number, number];
}

export interface WmoDoodadSet {
  name: string;
  start: number;
  count: number;
}

/** A model placed inside the building, in the building's own space. */
export interface WmoDoodad {
  fileId: number;
  position: [number, number, number];
  /** Quaternion x, y, z, w. */
  rotation: [number, number, number, number];
  scale: number;
}

export interface WmoRoot {
  materials: WmoMaterial[];
  doodadSets: WmoDoodadSet[];
  doodads: WmoDoodad[];
  /** The full-detail file of each group. */
  groupFileIds: number[];
}

export interface WmoBatch {
  indexStart: number;
  indexCount: number;
  material: number;
}

export const GROUP_EXTERIOR = 0x8;
export const GROUP_INTERIOR = 0x2000;

export interface WmoGroup {
  flags: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Baked light per vertex as B, G, R, A bytes, where the group has it. */
  colours: Uint8Array | undefined;
  indices: Uint16Array;
  batches: WmoBatch[];
  /** Which of the root's doodads stand in this group. */
  doodadRefs: Uint16Array;
}

export function parseWmoRoot(bytes: Uint8Array): WmoRoot {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = readChunks(bytes);
  const chunk = (id: string) => chunks.find((c) => c.id === id);
  const header = chunk('MOHD');
  if (!header) throw new Error('Not a world map object: it has no header');
  const groupCount = dv.getUint32(header.at + 4, true);

  const materials: WmoMaterial[] = [];
  const momt = chunk('MOMT');
  for (let at = momt?.at ?? 0, end = at + (momt?.size ?? 0); at + 64 <= end; at += 64) {
    materials.push({
      flags: dv.getUint32(at, true),
      shader: dv.getUint32(at + 4, true),
      blendMode: dv.getUint32(at + 8, true),
      textures: [dv.getUint32(at + 12, true), dv.getUint32(at + 24, true), dv.getUint32(at + 36, true)],
    });
  }

  const doodadSets: WmoDoodadSet[] = [];
  const mods = chunk('MODS');
  for (let at = mods?.at ?? 0, end = at + (mods?.size ?? 0); at + 32 <= end; at += 32) {
    let name = '';
    for (let i = 0; i < 20 && bytes[at + i]; i++) name += String.fromCharCode(bytes[at + i]!);
    doodadSets.push({ name, start: dv.getUint32(at + 20, true), count: dv.getUint32(at + 24, true) });
  }

  const modi = chunk('MODI');
  const doodads: WmoDoodad[] = [];
  const modd = chunk('MODD');
  for (let at = modd?.at ?? 0, end = at + (modd?.size ?? 0); at + 40 <= end; at += 40) {
    // The low 24 bits pick the model from the list of files; the top 8 are flags.
    const index = dv.getUint32(at, true) & 0xffffff;
    const f = (offset: number) => dv.getFloat32(at + offset, true);
    doodads.push({
      fileId: modi && index * 4 < modi.size ? dv.getUint32(modi.at + index * 4, true) : 0,
      position: [f(4), f(8), f(12)],
      rotation: [f(16), f(20), f(24), f(28)],
      scale: f(32),
    });
  }

  // The file list holds every level of detail in turn; the first run is the full detail.
  const gfid = chunk('GFID');
  const groupFileIds: number[] = [];
  for (let i = 0; gfid && i < groupCount && i * 4 < gfid.size; i++) groupFileIds.push(dv.getUint32(gfid.at + i * 4, true));

  return { materials, doodadSets, doodads, groupFileIds };
}

/** Bytes of the group header before its own chunks begin. */
const GROUP_HEADER = 68;

export function parseWmoGroup(bytes: Uint8Array): WmoGroup {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mogp = readChunks(bytes).find((c) => c.id === 'MOGP');
  if (!mogp) throw new Error('Not a world map object group');
  const f = (at: number) => dv.getFloat32(at, true);
  const flags = dv.getUint32(mogp.at + 8, true);
  const box = mogp.at + 12;
  const bounds: WmoGroup['bounds'] = { min: [f(box), f(box + 4), f(box + 8)], max: [f(box + 12), f(box + 16), f(box + 20)] };

  const chunks = readChunks(bytes, mogp.at + GROUP_HEADER, mogp.at + mogp.size);
  // Texture coordinates and colours can come more than once; the first of each is the base layer.
  const chunk = (id: string) => chunks.find((c) => c.id === id);
  // Copied, so each array starts on its own boundary whatever the chunk's offset.
  const floats = (id: string) => {
    const c = chunk(id);
    return c ? new Float32Array(bytes.slice(c.at, c.at + c.size).buffer) : new Float32Array(0);
  };
  const shorts = (id: string) => {
    const c = chunk(id);
    return c ? new Uint16Array(bytes.slice(c.at, c.at + (c.size & ~1)).buffer) : new Uint16Array(0);
  };
  const mocv = chunk('MOCV');

  const batches: WmoBatch[] = [];
  const moba = chunk('MOBA');
  for (let at = moba?.at ?? 0, end = at + (moba?.size ?? 0); at + 24 <= end; at += 24) {
    const batchFlags = bytes[at + 22]!;
    batches.push({
      indexStart: dv.getUint32(at + 12, true),
      indexCount: dv.getUint16(at + 16, true),
      // A building with more than 255 materials keeps the number in the box field instead.
      material: batchFlags & 0x2 ? dv.getUint16(at + 10, true) : bytes[at + 23]!,
    });
  }

  return {
    flags,
    bounds,
    positions: floats('MOVT'),
    normals: floats('MONR'),
    uvs: floats('MOTV'),
    colours: mocv ? bytes.slice(mocv.at, mocv.at + mocv.size) : undefined,
    indices: shorts('MOVI'),
    batches,
    doodadRefs: shorts('MODR'),
  };
}
