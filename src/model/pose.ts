import { type M2Array, type M2Bone, type M2Sequence, type M2Track, SEQUENCE_ALIAS, SEQUENCE_INLINE } from '../formats/m2';
import { type Mat4, multiply, pivotTransform } from '../math/mat4';

/** The animated skeleton of a model: its bones and sequences, and the block their inline keys live in. */
export interface Rig {
  md20: Uint8Array;
  sequences: M2Sequence[];
  bones: M2Bone[];
  globalSequences: Uint32Array;
}

/**
 * Key data of sequences stored outside the model, by sequence index. A sequence that is
 * neither inline nor present here has no keys yet and leaves its bones at rest.
 */
export type AnimBuffers = ReadonlyMap<number, Uint8Array>;

/** Index of the sequence for an animation ID and variation, or -1. */
export function findSequence(sequences: readonly M2Sequence[], id: number, variation = 0): number {
  return sequences.findIndex((sequence) => sequence.id === id && sequence.variation === variation);
}

/** Follow alias sequences to the one that holds the data. */
export function resolveAlias(sequences: readonly M2Sequence[], index: number): number {
  for (let hops = 0; hops < sequences.length; hops++) {
    const sequence = sequences[index];
    if (!sequence || (sequence.flags & SEQUENCE_ALIAS) === 0 || sequence.aliasNext === index) break;
    index = sequence.aliasNext;
  }
  return index;
}

interface Keys {
  dv: DataView;
  times: M2Array;
  values: M2Array;
  time: number;
}

/** Locate a track's keys for a sequence and the time to sample them at, or undefined if it has none. */
function keysOf(rig: Rig, track: M2Track, sequenceIndex: number, timeMs: number, anims?: AnimBuffers): Keys | undefined {
  let buffer: Uint8Array | undefined = rig.md20;
  let index = sequenceIndex;
  let time = timeMs;
  if (track.globalSequence >= 0) {
    // Runs on its own clock, independent of the sequence; its keys are always inline.
    index = 0;
    const length = rig.globalSequences[track.globalSequence] ?? 0;
    time = length > 0 ? timeMs % length : 0;
  } else if ((rig.sequences[sequenceIndex]!.flags & SEQUENCE_INLINE) === 0) {
    buffer = anims?.get(sequenceIndex);
  }
  const times = track.times[index];
  const values = track.values[index];
  if (!buffer || !times || !values || times.count === 0 || values.count === 0) return undefined;
  if (times.offset + times.count * 4 > buffer.length) return undefined;
  return { dv: new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength), times, values, time };
}

/** The key at or before `time`, and how far `time` is toward the next one. */
function locate(keys: Keys): { index: number; blend: number } {
  const { dv, times, time } = keys;
  const timeAt = (i: number) => dv.getUint32(times.offset + i * 4, true);
  const last = Math.min(times.count, keys.values.count) - 1;
  if (last <= 0 || time <= timeAt(0)) return { index: 0, blend: 0 };
  if (time >= timeAt(last)) return { index: last, blend: 0 };
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timeAt(mid) <= time) lo = mid;
    else hi = mid - 1;
  }
  const t0 = timeAt(lo);
  const t1 = timeAt(lo + 1);
  return { index: lo, blend: t1 > t0 ? (time - t0) / (t1 - t0) : 0 };
}

function sampleVec3(keys: Keys | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!keys) return fallback;
  const { index, blend } = locate(keys);
  const at = keys.values.offset + index * 12;
  const read = (p: number): [number, number, number] => [
    keys.dv.getFloat32(p, true),
    keys.dv.getFloat32(p + 4, true),
    keys.dv.getFloat32(p + 8, true),
  ];
  const a = read(at);
  if (blend === 0) return a;
  const b = read(at + 12);
  return [a[0] + (b[0] - a[0]) * blend, a[1] + (b[1] - a[1]) * blend, a[2] + (b[2] - a[2]) * blend];
}

type Quat = [number, number, number, number];

function sampleQuat(keys: Keys | undefined): Quat {
  if (!keys) return [0, 0, 0, 1];
  const { index, blend } = locate(keys);
  const at = keys.values.offset + index * 8;
  // Rotations are stored as four signed 16-bit numbers, offset so that 0 means -1 or +1.
  const component = (p: number) => {
    const v = keys.dv.getInt16(p, true);
    return (v < 0 ? v + 32768 : v - 32767) / 32767;
  };
  const read = (p: number): Quat => [component(p), component(p + 2), component(p + 4), component(p + 6)];
  const a = read(at);
  if (blend === 0) return a;
  const b = read(at + 8);
  // Normalised linear blend along the shorter arc; keys are close together.
  const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q: Quat = [
    a[0] + (sign * b[0] - a[0]) * blend,
    a[1] + (sign * b[1] - a[1]) * blend,
    a[2] + (sign * b[2] - a[2]) * blend,
    a[3] + (sign * b[3] - a[3]) * blend,
  ];
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/**
 * Bone matrices (16 floats each, model space) for a sequence at a time in milliseconds.
 * A vertex is posed by blending the matrices of its bones.
 */
export function poseBones(
  rig: Rig,
  sequenceIndex: number,
  timeMs: number,
  anims?: AnimBuffers,
  /** Per-bone adjustments from appearance choices (see formats/bone.ts), applied about the bone's pivot. */
  offsets?: ReadonlyMap<number, Float32Array>,
): Float32Array {
  const sequence = resolveAlias(rig.sequences, sequenceIndex);
  const duration = rig.sequences[sequence]?.duration ?? 0;
  const time = duration > 0 ? Math.min(Math.max(timeMs, 0), duration) : 0;

  const count = rig.bones.length;
  const matrices = new Float32Array(count * 16);
  const done = new Uint8Array(count);
  const local = new Float32Array(16);
  const adjust = new Float32Array(16);

  const solve = (i: number): Mat4 => {
    const out = matrices.subarray(i * 16, i * 16 + 16);
    if (done[i]) return out;
    done[i] = 1;
    const bone = rig.bones[i]!;
    const hasSequence = rig.sequences[sequence] !== undefined;
    const t = sampleVec3(hasSequence ? keysOf(rig, bone.translation, sequence, time, anims) : undefined, [0, 0, 0]);
    const q = sampleQuat(hasSequence ? keysOf(rig, bone.rotation, sequence, time, anims) : undefined);
    const s = sampleVec3(hasSequence ? keysOf(rig, bone.scale, sequence, time, anims) : undefined, [1, 1, 1]);
    pivotTransform(local, bone.pivot, t, q, s);
    const offset = offsets?.get(i);
    if (offset) {
      // The adjustment acts in the bone's own space: move the pivot to the origin, adjust, move back.
      const [px, py, pz] = bone.pivot;
      adjust.set(offset);
      adjust[12] = offset[12]! + px - (offset[0]! * px + offset[4]! * py + offset[8]! * pz);
      adjust[13] = offset[13]! + py - (offset[1]! * px + offset[5]! * py + offset[9]! * pz);
      adjust[14] = offset[14]! + pz - (offset[2]! * px + offset[6]! * py + offset[10]! * pz);
      multiply(local, local, adjust);
    }
    if (bone.parent >= 0) multiply(out, solve(bone.parent), local);
    else out.set(local);
    return out;
  };
  for (let i = 0; i < count; i++) solve(i);
  return matrices;
}
