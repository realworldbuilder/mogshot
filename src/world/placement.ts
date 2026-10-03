import { MAP_HALF, type Placement } from '../formats/adt';
import { chain, type Mat4, rotation, scaling, translation } from '../math/mat4';

const DEGREES = Math.PI / 180;

/**
 * Where a placed model or building sits in the world: the matrix from its own space to
 * world coordinates (x north, y west, z up, in yards). Tiles record placements in a space
 * of their own, measured from the map's corner with Y up; the turns are the game's
 * (wowdev.wiki, ADT/v18 MDDF).
 */
export function placementMatrix(placement: Placement): Mat4 {
  const [x, y, z] = placement.position;
  const [rx, ry, rz] = placement.rotation;
  return chain(
    // Placement space to the world: its axes turned to Z up, then measured from the middle of the map.
    translation(MAP_HALF, MAP_HALF, 0),
    rotation('z', Math.PI),
    rotation('x', Math.PI / 2),
    rotation('y', Math.PI / 2),
    translation(x, y, z),
    rotation('y', (ry - 270) * DEGREES),
    rotation('z', -rx * DEGREES),
    rotation('x', (rz - 90) * DEGREES),
    scaling(placement.scale),
  );
}
