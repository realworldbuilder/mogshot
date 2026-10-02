/** 4x4 matrices as 16 floats in column-major order (the layout WebGL expects). */
export type Mat4 = Float32Array;
export type Vec3 = readonly [number, number, number];

export function identity(out: Mat4 = new Float32Array(16)): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** out = a * b. `out` may be `a` or `b`. */
export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!;
  const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!;
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!;
  const a30 = a[12]!, a31 = a[13]!, a32 = a[14]!, a33 = a[15]!;
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4]!, b1 = b[c * 4 + 1]!, b2 = b[c * 4 + 2]!, b3 = b[c * 4 + 3]!;
    out[c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return out;
}

/**
 * The transform of an animated bone about its pivot:
 * translate(pivot) * translate(t) * rotate(q) * scale(s) * translate(-pivot).
 */
export function pivotTransform(
  out: Mat4,
  pivot: Vec3,
  t: Vec3,
  q: readonly [number, number, number, number],
  s: Vec3,
): Mat4 {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  // Rotation times scale, column by column.
  const m00 = (1 - 2 * (yy + zz)) * s[0], m01 = 2 * (xy + wz) * s[0], m02 = 2 * (xz - wy) * s[0];
  const m10 = 2 * (xy - wz) * s[1], m11 = (1 - 2 * (xx + zz)) * s[1], m12 = 2 * (yz + wx) * s[1];
  const m20 = 2 * (xz + wy) * s[2], m21 = 2 * (yz - wx) * s[2], m22 = (1 - 2 * (xx + yy)) * s[2];
  out[0] = m00; out[1] = m01; out[2] = m02; out[3] = 0;
  out[4] = m10; out[5] = m11; out[6] = m12; out[7] = 0;
  out[8] = m20; out[9] = m21; out[10] = m22; out[11] = 0;
  out[12] = pivot[0] + t[0] - (m00 * pivot[0] + m10 * pivot[1] + m20 * pivot[2]);
  out[13] = pivot[1] + t[1] - (m01 * pivot[0] + m11 * pivot[1] + m21 * pivot[2]);
  out[14] = pivot[2] + t[2] - (m02 * pivot[0] + m12 * pivot[1] + m22 * pivot[2]);
  out[15] = 1;
  return out;
}

export function transformPoint(m: Mat4, p: Vec3, at = 0): [number, number, number] {
  return [
    m[at]! * p[0] + m[at + 4]! * p[1] + m[at + 8]! * p[2] + m[at + 12]!,
    m[at + 1]! * p[0] + m[at + 5]! * p[1] + m[at + 9]! * p[2] + m[at + 13]!,
    m[at + 2]! * p[0] + m[at + 6]! * p[1] + m[at + 10]! * p[2] + m[at + 14]!,
  ];
}

/** Perspective projection with a vertical field of view in radians, looking down -Z. */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** View matrix for a camera at `eye` looking at `target`. */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const out = new Float32Array(16);
  out[0] = xx; out[1] = yx; out[2] = zx;
  out[4] = xy; out[5] = yy; out[6] = zy;
  out[8] = xz; out[9] = yz; out[10] = zz;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}
