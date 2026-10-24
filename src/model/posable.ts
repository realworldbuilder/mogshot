import { attachmentMatrix, type BoneLink, type PackedRig, wornBones } from '../character/scene';
import { identity, multiply, scaling, transformPoint } from '../math/mat4';
import { poseBones, resolveAlias } from './pose';

/*
 * Posing a packed character wherever it has been sent: the same bones and transforms the
 * scene builder's pose() gives, worked out synchronously from plain data, with no files to
 * read. A game that switches animations every frame, or a page the worker handed a character
 * to, poses it with this.
 */

export interface PosedMesh {
  bones: Float32Array;
  transform: Float32Array;
}

export interface PosableRig {
  /** How many meshes the scene has; a pose returns one entry for each, in order. */
  meshCount: number;
  /** The body's bones and each mesh's transform for a sequence at a time in milliseconds; the time is clamped to the sequence. */
  pose(sequence: number, timeMs: number): PosedMesh[];
  /** Length in milliseconds of a sequence, after aliases; 0 for one the rig lacks. */
  duration(sequence: number): number;
  /** Where an attachment point (1 right hand, 2 left hand, 11 helm ...) is in model space for a body pose, or undefined if the model has none. */
  attachment(bodyBones: Float32Array, attachmentId: number): [number, number, number] | undefined;
}

export function posableRig(packed: PackedRig): PosableRig {
  const { body, scale } = packed;
  const anims = new Map(packed.anims);
  const offsets = new Map(packed.boneOffsets);
  const override = packed.gripping && { sequence: packed.gripping.sequence, bones: new Set(packed.gripping.bones) };
  const bodyLinks: { bones: readonly BoneLink[] } = { bones: body.bones };
  const sized = scale !== 1 ? scaling(scale) : undefined;

  return {
    meshCount: packed.meshes.length,
    duration(sequence) {
      const holder = body.sequences[sequence] ? resolveAlias(body.sequences, sequence) : -1;
      return body.sequences[holder]?.duration ?? 0;
    },
    pose(sequence, timeMs) {
      const holder = body.sequences[sequence] ? resolveAlias(body.sequences, sequence) : -1;
      const duration = body.sequences[holder]?.duration ?? 0;
      const at = Math.min(Math.max(timeMs, 0), duration);
      const bones = poseBones(body, sequence, at, anims, offsets, override);
      return packed.meshes.map((mesh) => {
        let meshBones: Float32Array;
        let transform = identity();
        if (mesh.follows === 'body') meshBones = bones;
        else if (mesh.follows === 'worn') meshBones = wornBones(mesh, bodyLinks, bones);
        else {
          meshBones = mesh.own.slice();
          transform = attachmentMatrix(body, bones, mesh.attachment) ?? transform;
        }
        // The game's size for the model, about the feet, so a scaled character still stands on the ground.
        if (sized) transform = multiply(new Float32Array(16), sized, transform);
        return { bones: meshBones, transform };
      });
    },
    attachment(bodyBones, attachmentId) {
      const matrix = attachmentMatrix(body, bodyBones, attachmentId);
      if (!matrix) return undefined;
      const point = transformPoint(matrix, [0, 0, 0]);
      return [point[0] * scale, point[1] * scale, point[2] * scale];
    },
  };
}
