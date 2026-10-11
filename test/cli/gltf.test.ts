import { describe, expect, it } from 'vitest';
import { decompose, exportGlb } from '../../cli/gltf';
import type { CharacterScene } from '../../src/character/scene';
import { chain, rotation, scaling, translation } from '../../src/math/mat4';

const close = (a: number[], b: number[], digits = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

describe('decompose', () => {
  it('reads translation, rotation and scale back out of a matrix', () => {
    const m = chain(translation(1, 2, 3), rotation('z', Math.PI / 2), scaling(2));
    const { t, r, s } = decompose(m);
    close(t, [1, 2, 3]);
    close(s, [2, 2, 2]);
    // A quarter turn about Z.
    close(r.map(Math.abs), [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  });

  it('keeps a mirrored matrix mirrored through a negative scale', () => {
    const m = new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const { s } = decompose(m);
    expect(s[0]).toBeLessThan(0);
  });
});

describe('exportGlb', () => {
  /** One triangle on one bone, one texture, as a built scene would carry it. */
  const scene = (): CharacterScene => {
    const vertices = new Uint8Array(4 * 48);
    const dv = new DataView(vertices.buffer);
    const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [5, 5, 5]];
    corners.forEach(([x, y, z], v) => {
      dv.setFloat32(v * 48, x!, true);
      dv.setFloat32(v * 48 + 4, y!, true);
      dv.setFloat32(v * 48 + 8, z!, true);
      vertices[v * 48 + 12] = 255; // one bone, full weight
      dv.setFloat32(v * 48 + 28, 1, true); // normal z
    });
    return {
      meshes: [
        {
          vertices,
          indices: new Uint16Array([0, 1, 2]),
          bones: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
          transform: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
          billboards: [],
          draws: [{ sectionId: 0, indexStart: 0, indexCount: 3, shaderId: 0, textureCount: 1, blendMode: 0, materialFlags: 0, priority: 0, layer: 0, textures: [0] }],
        },
      ],
      textures: [{ width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255]), wrapX: true, wrapY: false }],
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      problems: [],
      options: [],
      choices: [],
      animations: [{ sequence: 0, id: 0, variation: 0, name: 'Stand', duration: 100 }],
      presets: [],
      pose: { sequence: 0, time: 0, duration: 100, preset: 'Stand' },
    };
  };

  it('writes a GLB whose JSON names the mesh, skin, texture and animation, with only the used vertices', async () => {
    const s = scene();
    const rig = { pose: async () => ({ meshes: [{ bones: s.meshes[0]!.bones, transform: s.meshes[0]!.transform }], bounds: s.bounds, pose: s.pose }) };
    const { glb, report } = await exportGlb(s, rig, { name: 'test', animations: s.animations, fps: 30 });
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(8, true)).toBe(glb.byteLength);
    const jsonLength = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
    expect(json.asset.version).toBe('2.0');
    expect(json.meshes).toHaveLength(1);
    expect(json.skins[0].joints).toHaveLength(1);
    expect(json.images[0].mimeType).toBe('image/png');
    expect(json.samplers[0]).toMatchObject({ wrapS: 10497, wrapT: 33071 });
    expect(json.animations[0].name).toBe('Stand');
    expect(json.animations[0].channels).toHaveLength(3);
    // The fourth vertex is in the model but no draw uses it.
    const position = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
    expect(position.count).toBe(3);
    expect(position.max).toEqual([1, 1, 0]);
    expect(report).toMatchObject({ meshes: 1, draws: 1, textures: 1, bones: 1, vertices: 3 });
    // 0, 33 and 67 ms, then the end at 100 ms.
    expect(report.animations[0]).toMatchObject({ name: 'Stand', frames: 4 });
  });
});
