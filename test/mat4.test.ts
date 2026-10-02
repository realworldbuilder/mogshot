import { describe, expect, it } from 'vitest';
import { identity, invert, lookAt, multiply, perspective, pivotTransform, transformPoint } from '../src/math/mat4';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));

describe('mat4', () => {
  it('multiplies in column-major order', () => {
    const translate = identity();
    translate[12] = 5;
    const scale = identity();
    scale[0] = 2;
    // translate * scale: scale first, then translate.
    close(transformPoint(multiply(new Float32Array(16), translate, scale), [1, 1, 1]), [7, 1, 1]);
    close(transformPoint(multiply(new Float32Array(16), scale, translate), [1, 1, 1]), [12, 1, 1]);
  });

  it('rotates about a pivot', () => {
    // 90 degrees about Z: quaternion (0, 0, sin 45, cos 45).
    const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
    const m = pivotTransform(new Float32Array(16), [1, 0, 0], [0, 0, 0], q, [1, 1, 1]);
    close(transformPoint(m, [1, 0, 0]), [1, 0, 0]); // the pivot stays put
    close(transformPoint(m, [2, 0, 0]), [1, 1, 0]); // +X of the pivot swings to +Y
  });

  it('applies translation and scale about the pivot', () => {
    const m = pivotTransform(new Float32Array(16), [1, 1, 1], [0, 0, 3], [0, 0, 0, 1], [2, 2, 2]);
    close(transformPoint(m, [1, 1, 1]), [1, 1, 4]);
    close(transformPoint(m, [2, 1, 1]), [3, 1, 4]);
  });

  it('looks down the view axis and projects the centre to the middle', () => {
    const view = lookAt([5, 0, 1], [0, 0, 1], [0, 0, 1]);
    close(transformPoint(view, [0, 0, 1]), [0, 0, -5]);
    close(transformPoint(view, [0, 0, 2]), [0, 1, -5]); // world up is screen up
    const clip = multiply(new Float32Array(16), perspective(Math.PI / 2, 1, 0.1, 100), view);
    const [x, y] = transformPoint(clip, [0, 0, 1]);
    close([x, y], [0, 0]);
  });

  it('inverts a transform', () => {
    const m = pivotTransform(new Float32Array(16), [1, 2, 3], [4, 5, 6], [0, 0, Math.SQRT1_2, Math.SQRT1_2], [2, 2, 2]);
    const product = multiply(new Float32Array(16), m, invert(new Float32Array(16), m));
    close(Array.from(product), Array.from(identity()));
  });
});
