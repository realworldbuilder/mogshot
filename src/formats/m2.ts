/*
 * Reader for M2 models (chunked "MD21" files). Layout follows wowdev.wiki and wow.export's
 * M2Loader (MIT, Kruithne and Marlamin). Coordinates are kept as stored: X forward, Y left,
 * Z up.
 */

/** A count and a position inside the MD20 block. */
export interface M2Array {
  count: number;
  offset: number;
}

/**
 * An animated value. Keys are stored per sequence, either inside the model or in that
 * sequence's .anim file, so only their locations are read here; see `animation.ts`.
 */
export interface M2Track {
  interpolation: number;
  globalSequence: number;
  /** Per sequence: where its key times are. */
  times: M2Array[];
  /** Per sequence: where its key values are. */
  values: M2Array[];
}

export interface M2Sequence {
  id: number;
  variation: number;
  duration: number;
  flags: number;
  /** Index of the next variation of the same animation, or -1. */
  variationNext: number;
  /** For alias sequences (flag 0x40): the sequence that holds the data. */
  aliasNext: number;
}

/** Sequence keys are stored inside the model, not in a .anim file. */
export const SEQUENCE_INLINE = 0x20;
export const SEQUENCE_ALIAS = 0x40;

/** Bone flag: the bone turns to face the camera (glows and other flat effects hang from such bones). */
export const BONE_BILLBOARD = 0x8;

export interface M2Bone {
  /** Well-known role of the bone (arm, head, finger ...), or -1. */
  keyBoneId: number;
  flags: number;
  parent: number;
  nameHash: number;
  translation: M2Track;
  rotation: M2Track;
  scale: M2Track;
  pivot: [number, number, number];
}

export interface M2Texture {
  /** 0 = the file in `fileId`; otherwise a slot filled by the character (skin, hair, ...). */
  type: number;
  flags: number;
  fileId: number;
}

export interface M2Material {
  flags: number;
  blendMode: number;
}

export interface M2Attachment {
  id: number;
  bone: number;
  position: [number, number, number];
}

export interface M2Model {
  version: number;
  name: string;
  flags: number;
  /** The MD20 block; track offsets point into it. */
  md20: Uint8Array;
  globalSequences: Uint32Array;
  sequences: M2Sequence[];
  bones: M2Bone[];
  /** Raw vertices, 48 bytes each: position, 4 bone weights, 4 bone indices, normal, two UV sets. */
  vertices: Uint8Array;
  vertexCount: number;
  skinProfileCount: number;
  textures: M2Texture[];
  materials: M2Material[];
  textureCombos: Uint16Array;
  textureWeightCombos: Uint16Array;
  textureTransformCombos: Uint16Array;
  textureWeights: M2Track[];
  colors: { color: M2Track; alpha: M2Track }[];
  attachments: M2Attachment[];
  attachmentLookup: Int16Array;
  /** Skin files: the first `skinProfileCount` are the model's views, the rest are LODs. */
  skinFileIds: number[];
  skeletonFileId: number;
  animFiles: { sequenceId: number; variation: number; fileId: number }[];
  boneFileIds: number[];
}

export const VERTEX_SIZE = 48;

const tag = (name: string) =>
  name.charCodeAt(0) | (name.charCodeAt(1) << 8) | (name.charCodeAt(2) << 16) | (name.charCodeAt(3) << 24);

const MD21 = tag('MD21');
const MD20 = tag('MD20');
const SFID = tag('SFID');
const TXID = tag('TXID');
const SKID = tag('SKID');
const AFID = tag('AFID');
const BFID = tag('BFID');

export function parseM2(bytes: Uint8Array): M2Model {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let model: M2Model | undefined;
  const pending: { id: number; start: number; size: number }[] = [];

  for (let p = 0; p + 8 <= bytes.length; ) {
    const id = dv.getUint32(p, true);
    const size = dv.getUint32(p + 4, true);
    if (id === MD21) model = parseMd20(bytes.subarray(p + 8, p + 8 + size));
    else pending.push({ id, start: p + 8, size });
    p += 8 + size;
  }
  if (!model) throw new Error('Not an M2 model (no MD21 chunk)');

  for (const { id, start, size } of pending) {
    if (id === SFID) {
      for (let i = 0; i < size / 4; i++) model.skinFileIds.push(dv.getUint32(start + i * 4, true));
    } else if (id === TXID) {
      model.textures.forEach((texture, i) => {
        if (i < size / 4) texture.fileId = dv.getUint32(start + i * 4, true);
      });
    } else if (id === SKID) {
      model.skeletonFileId = dv.getUint32(start, true);
    } else if (id === AFID) {
      for (let i = 0; i < size / 8; i++) {
        model.animFiles.push({
          sequenceId: dv.getUint16(start + i * 8, true),
          variation: dv.getUint16(start + i * 8 + 2, true),
          fileId: dv.getUint32(start + i * 8 + 4, true),
        });
      }
    } else if (id === BFID) {
      for (let i = 0; i < size / 4; i++) model.boneFileIds.push(dv.getUint32(start + i * 4, true));
    }
  }
  return model;
}

/** Read the track header at `at`: interpolation, global sequence, key-time and key-value arrays. */
export function readTrack(dv: DataView, at: number): M2Track {
  const arrays = (headerAt: number): M2Array[] => {
    const count = dv.getUint32(headerAt, true);
    const offset = dv.getUint32(headerAt + 4, true);
    const out: M2Array[] = [];
    for (let i = 0; i < count; i++) {
      out.push({ count: dv.getUint32(offset + i * 8, true), offset: dv.getUint32(offset + i * 8 + 4, true) });
    }
    return out;
  };
  return {
    interpolation: dv.getUint16(at, true),
    globalSequence: dv.getInt16(at + 2, true),
    times: arrays(at + 4),
    values: arrays(at + 12),
  };
}

export function readSequences(dv: DataView, array: M2Array): M2Sequence[] {
  const sequences: M2Sequence[] = [];
  for (let i = 0; i < array.count; i++) {
    const at = array.offset + i * 64;
    sequences.push({
      id: dv.getUint16(at, true),
      variation: dv.getUint16(at + 2, true),
      duration: dv.getUint32(at + 4, true),
      flags: dv.getUint32(at + 12, true),
      variationNext: dv.getInt16(at + 60, true),
      aliasNext: dv.getUint16(at + 62, true),
    });
  }
  return sequences;
}

export function readBones(dv: DataView, array: M2Array): M2Bone[] {
  const bones: M2Bone[] = [];
  for (let i = 0; i < array.count; i++) {
    const at = array.offset + i * 88;
    let parent = dv.getInt16(at + 8, true);
    // A parent that points at the bone itself or outside the list would loop or crash the solver.
    if (parent === i || parent >= array.count || parent < -1) parent = -1;
    bones.push({
      keyBoneId: dv.getInt32(at, true),
      flags: dv.getUint32(at + 4, true),
      parent,
      nameHash: dv.getUint32(at + 12, true),
      translation: readTrack(dv, at + 16),
      rotation: readTrack(dv, at + 36),
      scale: readTrack(dv, at + 56),
      pivot: [dv.getFloat32(at + 76, true), dv.getFloat32(at + 80, true), dv.getFloat32(at + 84, true)],
    });
  }
  return bones;
}

function parseMd20(md20: Uint8Array): M2Model {
  const dv = new DataView(md20.buffer, md20.byteOffset, md20.byteLength);
  if (dv.getUint32(0, true) !== MD20) throw new Error('Not an M2 model (bad MD20 block)');
  const array = (at: number): M2Array => ({ count: dv.getUint32(at, true), offset: dv.getUint32(at + 4, true) });
  const u16s = (a: M2Array) => new Uint16Array(md20.slice(a.offset, a.offset + a.count * 2).buffer);

  const nameArray = array(8);
  const name = new TextDecoder().decode(md20.subarray(nameArray.offset, nameArray.offset + Math.max(0, nameArray.count - 1)));

  const globalSequenceArray = array(20);
  const vertices = array(60);
  const colors = array(72);
  const textures = array(80);
  const textureWeights = array(88);
  const materials = array(112);
  const attachments = array(240);
  const attachmentLookup = array(248);

  return {
    version: dv.getUint32(4, true),
    name,
    flags: dv.getUint32(16, true),
    md20,
    globalSequences: new Uint32Array(
      md20.slice(globalSequenceArray.offset, globalSequenceArray.offset + globalSequenceArray.count * 4).buffer,
    ),
    sequences: readSequences(dv, array(28)),
    bones: readBones(dv, array(44)),
    vertices: md20.subarray(vertices.offset, vertices.offset + vertices.count * VERTEX_SIZE),
    vertexCount: vertices.count,
    skinProfileCount: dv.getUint32(68, true),
    textures: Array.from({ length: textures.count }, (_, i) => ({
      type: dv.getUint32(textures.offset + i * 16, true),
      flags: dv.getUint32(textures.offset + i * 16 + 4, true),
      fileId: 0,
    })),
    materials: Array.from({ length: materials.count }, (_, i) => ({
      flags: dv.getUint16(materials.offset + i * 4, true),
      blendMode: dv.getUint16(materials.offset + i * 4 + 2, true),
    })),
    textureCombos: u16s(array(128)),
    textureWeightCombos: u16s(array(144)),
    textureTransformCombos: u16s(array(152)),
    textureWeights: Array.from({ length: textureWeights.count }, (_, i) => readTrack(dv, textureWeights.offset + i * 20)),
    colors: Array.from({ length: colors.count }, (_, i) => ({
      color: readTrack(dv, colors.offset + i * 40),
      alpha: readTrack(dv, colors.offset + i * 40 + 20),
    })),
    attachments: Array.from({ length: attachments.count }, (_, i) => {
      const at = attachments.offset + i * 40;
      return {
        id: dv.getUint32(at, true),
        bone: dv.getUint16(at + 4, true),
        position: [dv.getFloat32(at + 8, true), dv.getFloat32(at + 12, true), dv.getFloat32(at + 16, true)],
      };
    }),
    attachmentLookup: new Int16Array(
      md20.slice(attachmentLookup.offset, attachmentLookup.offset + attachmentLookup.count * 2).buffer,
    ),
    skinFileIds: [],
    skeletonFileId: 0,
    animFiles: [],
    boneFileIds: [],
  };
}
