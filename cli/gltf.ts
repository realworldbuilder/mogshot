/*
 * A built character as a glTF binary (GLB) for Blender and other 3D tools: its meshes with
 * the textures Mogshot composited, a skeleton, and animations baked frame by frame from the
 * same poses the renderer draws. Nothing here reads game files; it serialises what
 * `buildCharacterScene` and `rig.pose` already give.
 *
 * Skinning is kept as the game does it: each bone's matrix maps a rest-pose vertex straight
 * into the posed model, so every joint is a root joint (no hierarchy) and the inverse bind
 * matrices are identity. Blender poses it exactly as Mogshot does; it just has no parent
 * chain to drag by hand, which a render does not need.
 */
import type { AnimationInfo, CharacterRig, CharacterScene, SceneMesh } from '../src/character/scene';
import { VERTEX_SIZE } from '../src/formats/m2';
import { type Mat4, multiply } from '../src/math/mat4';
import { encodePng } from '../src/render/export';

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const REPEAT = 10497;
const CLAMP = 33071;

/**
 * The game's axes (X forward, Y left, Z up) to glTF's (Y up, right-handed), as a node matrix,
 * column-major: X -> +Z, Y -> +X, Z -> +Y. In Blender (which turns glTF's Y up into Z up) the
 * model then faces -Y, so a camera on -Y looking at the origin sees its face.
 */
const AXES: number[] = [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];

export interface GltfOptions {
  /** A name for the root node and the file's generator line. */
  name: string;
  /** Animations to bake, and the rate to bake them at. */
  animations: AnimationInfo[];
  fps: number;
}

export interface GltfReport {
  meshes: number;
  draws: number;
  textures: number;
  bones: number;
  vertices: number;
  animations: { name: string; frames: number; seconds: number }[];
}

/** A glTF buffer being written: bytes appended four-aligned, each run described by a buffer view and an accessor. */
class Blob {
  private parts: Uint8Array[] = [];
  private size = 0;
  readonly bufferViews: Record<string, unknown>[] = [];
  readonly accessors: Record<string, unknown>[] = [];

  /** Append bytes; returns the buffer view index. */
  view(bytes: Uint8Array, extra: Record<string, unknown> = {}): number {
    const padded = (this.size + 3) & ~3;
    if (padded > this.size) this.parts.push(new Uint8Array(padded - this.size));
    this.size = padded;
    this.parts.push(bytes);
    this.bufferViews.push({ buffer: 0, byteOffset: this.size, byteLength: bytes.byteLength, ...extra });
    this.size += bytes.byteLength;
    return this.bufferViews.length - 1;
  }

  accessor(array: Float32Array | Uint16Array | Uint8Array, type: string, extra: Record<string, unknown> = {}, target?: number): number {
    const componentType = array instanceof Float32Array ? FLOAT : array instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_BYTE;
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const bufferView = this.view(bytes, target !== undefined ? { target } : {});
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]!;
    this.accessors.push({ bufferView, componentType, count: array.length / components, type, ...extra });
    return this.accessors.length - 1;
  }

  bytes(): Uint8Array {
    const padded = (this.size + 3) & ~3;
    const out = new Uint8Array(padded);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.byteLength;
    }
    return out;
  }
}

function minMax(array: Float32Array, components: number): { min: number[]; max: number[] } {
  const min = new Array<number>(components).fill(Infinity);
  const max = new Array<number>(components).fill(-Infinity);
  for (let i = 0; i < array.length; i += components) {
    for (let c = 0; c < components; c++) {
      const v = array[i + c]!;
      if (v < min[c]!) min[c] = v;
      if (v > max[c]!) max[c] = v;
    }
  }
  return { min, max };
}

/** Translation, rotation (quaternion) and scale of a column-major matrix, as glTF stores a node. */
export function decompose(m: Float32Array | number[], at = 0): { t: number[]; r: number[]; s: number[] } {
  const e = (col: number, row: number) => m[at + col * 4 + row]!;
  let sx = Math.hypot(e(0, 0), e(0, 1), e(0, 2));
  const sy = Math.hypot(e(1, 0), e(1, 1), e(1, 2));
  const sz = Math.hypot(e(2, 0), e(2, 1), e(2, 2));
  // A mirrored matrix (negative determinant) keeps its handedness in a negative x scale.
  const det =
    e(0, 0) * (e(1, 1) * e(2, 2) - e(2, 1) * e(1, 2)) - e(1, 0) * (e(0, 1) * e(2, 2) - e(2, 1) * e(0, 2)) + e(2, 0) * (e(0, 1) * e(1, 2) - e(1, 1) * e(0, 2));
  if (det < 0) sx = -sx;
  const r = (col: number, row: number) => e(col, row) / [sx, sy, sz][col]!;
  // Rotation matrix to quaternion (row, column) = r(col, row).
  const m00 = r(0, 0), m01 = r(1, 0), m02 = r(2, 0);
  const m10 = r(0, 1), m11 = r(1, 1), m12 = r(2, 1);
  const m20 = r(0, 2), m21 = r(1, 2), m22 = r(2, 2);
  const trace = m00 + m11 + m22;
  let q: number[];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const length = Math.hypot(...q) || 1;
  return { t: [e(3, 0), e(3, 1), e(3, 2)], r: q.map((v) => v / length), s: [sx, sy, sz] };
}

/** The matrices of a mesh's bones with its placement folded in: what moves a rest vertex to where it is drawn. */
function jointMatrices(mesh: { bones: Float32Array; transform: Float32Array }): Float32Array {
  const count = mesh.bones.length / 16;
  const out = new Float32Array(Math.max(count, 1) * 16);
  if (count === 0) {
    out.set(mesh.transform);
    return out;
  }
  const tmp = new Float32Array(16);
  for (let j = 0; j < count; j++) {
    multiply(tmp as Mat4, mesh.transform as Mat4, mesh.bones.subarray(j * 16, j * 16 + 16) as Mat4);
    out.set(tmp, j * 16);
  }
  return out;
}

/**
 * Vertex attributes of a mesh, unpacked from the model's 48-byte vertices. Only the vertices
 * its draws use are kept (the model holds every hairstyle and geoset, drawn or not), so the
 * file is small and a 3D tool's bounding box is the character, not the whole wardrobe.
 */
function attributes(mesh: SceneMesh) {
  const used = new Int32Array(mesh.vertices.byteLength / VERTEX_SIZE).fill(-1);
  let count = 0;
  for (const draw of mesh.draws) {
    for (let i = draw.indexStart; i < draw.indexStart + draw.indexCount; i++) {
      const v = mesh.indices[i]!;
      if (used[v] === -1) used[v] = count++;
    }
  }
  const remap = (indices: Uint16Array) => indices.map((v) => used[v]!);
  const dv = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const joints = new Uint8Array(count * 4);
  const weights = new Float32Array(count * 4);
  const boneCount = Math.max(1, mesh.bones.length / 16);
  for (let source = 0; source < used.length; source++) {
    const v = used[source]!;
    if (v === -1) continue;
    const at = source * VERTEX_SIZE;
    for (let c = 0; c < 3; c++) {
      position[v * 3 + c] = dv.getFloat32(at + c * 4, true);
      normal[v * 3 + c] = dv.getFloat32(at + 20 + c * 4, true);
    }
    const nl = Math.hypot(normal[v * 3]!, normal[v * 3 + 1]!, normal[v * 3 + 2]!);
    if (nl > 0) for (let c = 0; c < 3; c++) normal[v * 3 + c]! /= nl;
    uv[v * 2] = dv.getFloat32(at + 32, true);
    uv[v * 2 + 1] = dv.getFloat32(at + 36, true);
    let total = 0;
    for (let k = 0; k < 4; k++) total += mesh.vertices[at + 12 + k]!;
    for (let k = 0; k < 4; k++) {
      const w = mesh.vertices[at + 12 + k]!;
      const bone = mesh.vertices[at + 16 + k]!;
      joints[v * 4 + k] = w > 0 && bone < boneCount ? bone : 0;
      // A vertex no bone claims stays where it is: bone 0 at full weight (its matrix is the model's root).
      weights[v * 4 + k] = total > 0 ? w / total : k === 0 ? 1 : 0;
    }
  }
  return { count, position, normal, uv, joints, weights, remap };
}

const ALPHA_MODES: Record<number, string> = { 0: 'OPAQUE', 1: 'MASK' };

export async function exportGlb(scene: CharacterScene, rig: CharacterRig, options: GltfOptions): Promise<{ glb: Uint8Array; report: GltfReport }> {
  const blob = new Blob();
  const nodes: Record<string, unknown>[] = [{ name: options.name, matrix: AXES, children: [] as number[] }];
  const rootChildren = nodes[0]!.children as number[];
  const meshes: Record<string, unknown>[] = [];
  const skins: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const images: Record<string, unknown>[] = [];
  const textures: Record<string, unknown>[] = [];
  const samplers: Record<string, unknown>[] = [];

  // Textures: each composited image once, as a PNG inside the buffer.
  for (const [i, texture] of scene.textures.entries()) {
    const png = await encodePng(texture);
    const bufferView = blob.view(png);
    images.push({ name: `texture-${i}`, mimeType: 'image/png', bufferView });
    samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: texture.wrapX ? REPEAT : CLAMP, wrapT: texture.wrapY ? REPEAT : CLAMP });
    textures.push({ source: i, sampler: i });
  }

  // One material per distinct (texture, blend, flags) a draw asks for.
  const materialIndex = new Map<string, number>();
  const materialFor = (draw: SceneMesh['draws'][number]) => {
    const texture = draw.textures[0] ?? -1;
    const key = `${texture}/${draw.blendMode}/${draw.materialFlags}`;
    let index = materialIndex.get(key);
    if (index === undefined) {
      index = materials.length;
      materialIndex.set(key, index);
      const material: Record<string, unknown> = {
        name: `material-${index}`,
        pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.85, ...(texture >= 0 ? { baseColorTexture: { index: texture } } : {}) },
        alphaMode: ALPHA_MODES[draw.blendMode] ?? 'BLEND',
        doubleSided: (draw.materialFlags & 0x4) !== 0,
        // glTF has no additive blending; the game's mode and flags ride along for a tool to rebuild it (3 and 4 add).
        extras: { blendMode: draw.blendMode, materialFlags: draw.materialFlags, unlit: (draw.materialFlags & 0x1) !== 0 },
      };
      if (draw.blendMode === 1) material.alphaCutoff = 0.5;
      if (draw.materialFlags & 0x1) material.extensions = { KHR_materials_unlit: {} };
      materials.push(material);
    }
    return index;
  };

  // Meshes, each with its own flat skeleton.
  const jointNodes: number[][] = [];
  let bones = 0;
  let vertices = 0;
  let draws = 0;
  for (const [i, mesh] of scene.meshes.entries()) {
    const a = attributes(mesh);
    vertices += a.count;
    const posRange = minMax(a.position, 3);
    const POSITION = blob.accessor(a.position, 'VEC3', posRange, ARRAY_BUFFER);
    const NORMAL = blob.accessor(a.normal, 'VEC3', {}, ARRAY_BUFFER);
    const TEXCOORD_0 = blob.accessor(a.uv, 'VEC2', {}, ARRAY_BUFFER);
    const JOINTS_0 = blob.accessor(a.joints, 'VEC4', {}, ARRAY_BUFFER);
    const WEIGHTS_0 = blob.accessor(a.weights, 'VEC4', {}, ARRAY_BUFFER);
    const primitives = mesh.draws
      .filter((draw) => draw.indexCount > 0)
      .map((draw) => {
        const indices = a.remap(mesh.indices.subarray(draw.indexStart, draw.indexStart + draw.indexCount));
        draws++;
        return {
          attributes: { POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0 },
          indices: blob.accessor(indices, 'SCALAR', {}, ELEMENT_ARRAY_BUFFER),
          material: materialFor(draw),
          extras: { geoset: draw.sectionId },
        };
      });
    meshes.push({ name: `mesh-${i}`, primitives });

    const initial = jointMatrices(mesh);
    const count = initial.length / 16;
    bones += count;
    const joints: number[] = [];
    for (let j = 0; j < count; j++) {
      const { t, r, s } = decompose(initial, j * 16);
      joints.push(nodes.length);
      nodes.push({ name: `m${i}-bone-${j}`, translation: t, rotation: r, scale: s });
    }
    jointNodes.push(joints);
    rootChildren.push(...joints);
    skins.push({ name: `skin-${i}`, joints, skeleton: 0 });
    const meshNode = nodes.length;
    nodes.push({ name: `mesh-${i}`, mesh: i, skin: i });
    rootChildren.push(meshNode);
  }

  // Animations: the rig posed at every frame, each joint's matrix decomposed into keys.
  const animations: Record<string, unknown>[] = [];
  const report: GltfReport['animations'] = [];
  for (const animation of options.animations) {
    const step = 1000 / options.fps;
    const times: number[] = [];
    for (let t = 0; t < animation.duration; t += step) times.push(t);
    times.push(animation.duration);
    const frames = times.length;
    const input = blob.accessor(new Float32Array(times.map((t) => t / 1000)), 'SCALAR', { min: [0], max: [animation.duration / 1000] });
    // One matrix per joint per frame, then split into channels.
    const perMesh = scene.meshes.map((mesh) => new Float32Array(frames * Math.max(1, mesh.bones.length / 16) * 16));
    for (const [f, time] of times.entries()) {
      const posed = await rig.pose(animation.sequence, time);
      posed.meshes.forEach((m, i) => {
        const matrices = jointMatrices(m);
        perMesh[i]!.set(matrices, f * matrices.length);
      });
    }
    const channels: Record<string, unknown>[] = [];
    const samplersOut: Record<string, unknown>[] = [];
    scene.meshes.forEach((_mesh, i) => {
      const matrices = perMesh[i]!;
      const count = matrices.length / 16 / frames;
      for (let j = 0; j < count; j++) {
        const T = new Float32Array(frames * 3);
        const R = new Float32Array(frames * 4);
        const S = new Float32Array(frames * 3);
        for (let f = 0; f < frames; f++) {
          const { t, r, s } = decompose(matrices, (f * count + j) * 16);
          T.set(t, f * 3);
          R.set(r, f * 4);
          S.set(s, f * 3);
        }
        const node = jointNodes[i]![j]!;
        for (const [path, output, type] of [['translation', T, 'VEC3'], ['rotation', R, 'VEC4'], ['scale', S, 'VEC3']] as const) {
          samplersOut.push({ input, output: blob.accessor(output, type), interpolation: 'LINEAR' });
          channels.push({ sampler: samplersOut.length - 1, target: { node, path } });
        }
      }
    });
    animations.push({ name: animation.name, channels, samplers: samplersOut });
    report.push({ name: animation.name, frames, seconds: Number((animation.duration / 1000).toFixed(2)) });
  }

  const bin = blob.bytes();
  const json = {
    asset: { version: '2.0', generator: `Mogshot (${options.name})` },
    extensionsUsed: materials.some((m) => m.extensions) ? ['KHR_materials_unlit'] : undefined,
    scene: 0,
    scenes: [{ name: options.name, nodes: [0] }],
    nodes,
    meshes,
    skins,
    materials,
    images,
    textures,
    samplers,
    animations: animations.length > 0 ? animations : undefined,
    accessors: blob.accessors,
    bufferViews: blob.bufferViews,
    buffers: [{ byteLength: bin.byteLength }],
  };
  return { glb: glb(JSON.stringify(json), bin), report: { meshes: scene.meshes.length, draws, textures: scene.textures.length, bones, vertices, animations: report } };
}

/** The GLB container: a 12-byte header, the JSON chunk padded with spaces, the binary chunk padded with zeros. */
function glb(json: string, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(json);
  const jsonLength = (text.length + 3) & ~3;
  const binLength = (bin.length + 3) & ~3;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  const binAt = 20 + jsonLength;
  dv.setUint32(binAt, binLength, true);
  dv.setUint32(binAt + 4, 0x004e4942, true); // 'BIN'
  out.set(bin, binAt + 8);
  return out;
}
