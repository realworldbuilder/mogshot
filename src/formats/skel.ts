/*
 * Reader for .skel files: the bones, sequences and attachments of a model that keeps its
 * skeleton outside the .m2 (retail's newer models, named by the model's SKID chunk).
 * Each SK*1 chunk is a block of the MD20 layout whose offsets count from the chunk's start.
 * A skeleton may name a parent (SKPD) whose .anim files it borrows. Layout follows
 * wowdev.wiki (M2/.skel) and wow.export's SKELLoader (MIT).
 */
import { type M2Attachment, type M2Bone, type M2Model, type M2Sequence, readBones, readSequences } from './m2';

const tag = (name: string) =>
  name.charCodeAt(0) | (name.charCodeAt(1) << 8) | (name.charCodeAt(2) << 16) | (name.charCodeAt(3) << 24);

const SKA1 = tag('SKA1');
const SKB1 = tag('SKB1');
const SKS1 = tag('SKS1');
const SKPD = tag('SKPD');
const AFID = tag('AFID');
const BFID = tag('BFID');

export interface Skeleton {
  /** The SKB1 chunk: inline bone keys point into it. */
  boneData?: Uint8Array;
  bones?: M2Bone[];
  sequences?: M2Sequence[];
  globalSequences?: Uint32Array;
  attachments?: M2Attachment[];
  attachmentLookup?: Int16Array;
  animFiles: M2Model['animFiles'];
  boneFileIds: number[];
  /** The skeleton this one borrows from, or 0. */
  parentFileId: number;
}

export function parseSkel(bytes: Uint8Array): Skeleton {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const skeleton: Skeleton = { animFiles: [], boneFileIds: [], parentFileId: 0 };
  for (let p = 0; p + 8 <= bytes.length; ) {
    const id = dv.getUint32(p, true);
    const size = dv.getUint32(p + 4, true);
    const body = bytes.subarray(p + 8, p + 8 + size);
    const at = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const array = (offset: number) => ({ count: at.getUint32(offset, true), offset: at.getUint32(offset + 4, true) });
    const copy = (a: { count: number; offset: number }, width: number) => body.slice(a.offset, a.offset + a.count * width).buffer;
    if (id === SKB1) {
      skeleton.boneData = body;
      skeleton.bones = readBones(at, array(0));
    } else if (id === SKS1) {
      skeleton.globalSequences = new Uint32Array(copy(array(0), 4));
      skeleton.sequences = readSequences(at, array(8));
    } else if (id === SKA1) {
      const list = array(0);
      skeleton.attachments = Array.from({ length: list.count }, (_, i) => {
        const o = list.offset + i * 40;
        return {
          id: at.getUint32(o, true),
          bone: at.getUint16(o + 4, true),
          position: [at.getFloat32(o + 8, true), at.getFloat32(o + 12, true), at.getFloat32(o + 16, true)] as [number, number, number],
        };
      });
      skeleton.attachmentLookup = new Int16Array(copy(array(8), 2));
    } else if (id === SKPD) {
      skeleton.parentFileId = at.getUint32(8, true);
    } else if (id === AFID) {
      for (let i = 0; i + 8 <= size; i += 8) {
        skeleton.animFiles.push({ sequenceId: at.getUint16(i, true), variation: at.getUint16(i + 2, true), fileId: at.getUint32(i + 4, true) });
      }
    } else if (id === BFID) {
      for (let i = 0; i + 4 <= size; i += 4) skeleton.boneFileIds.push(at.getUint32(i, true));
    }
    p += 8 + size;
  }
  return skeleton;
}

/**
 * The model with its skeleton put back where an older model keeps it, so the rest of Mogshot
 * reads it as it reads any model. What the skeleton lacks comes from its parent, then the model.
 */
export function withSkeleton(model: M2Model, skeleton: Skeleton, parent?: Skeleton): M2Model {
  const pick = <K extends keyof Skeleton>(key: K) => skeleton[key] ?? parent?.[key];
  const boneData = pick('boneData');
  return {
    ...model,
    md20: boneData ?? model.md20,
    bones: pick('bones') ?? model.bones,
    sequences: pick('sequences') ?? model.sequences,
    globalSequences: pick('globalSequences') ?? model.globalSequences,
    attachments: pick('attachments') ?? model.attachments,
    attachmentLookup: pick('attachmentLookup') ?? model.attachmentLookup,
    animFiles: skeleton.animFiles.length > 0 ? skeleton.animFiles : (parent?.animFiles ?? model.animFiles),
    boneFileIds: skeleton.boneFileIds.length > 0 ? skeleton.boneFileIds : (parent?.boneFileIds ?? model.boneFileIds),
  };
}
