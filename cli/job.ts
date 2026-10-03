import type { CharacterScene, PoseResult } from '../src/character/scene';
import type { Image } from '../src/formats/blp';
import type { Backdrop } from '../src/render/backdrop';
import type { ClipFormat } from '../src/render/clip';
import type { Camera } from '../src/render/renderer';

/** One picture for the page to draw. Crosses from Node packed by `wire.ts`. */
export interface Job {
  scene: CharacterScene;
  camera: Camera;
  width: number;
  height: number;
  tight: boolean;
  backdrop: Backdrop;
  /** The loading screen's pixels, when the backdrop is one. */
  screen?: Image;
  classicScreen: boolean;
  /** Draw a clip instead of a picture: the scene in each of these poses, one a frame. */
  clip?: {
    format: ClipFormat;
    fps: number;
    /** The box the camera stays framed on. */
    framing: CharacterScene['bounds'];
    poses: PoseResult['meshes'][];
  };
}

export interface Drawn {
  width: number;
  height: number;
  /** Frames drawn, for a clip. */
  frames?: number;
  /** What the renderer could not draw. */
  problems: string[];
  /** The graphics card as the browser names it. */
  graphics: string;
}

/** Where the page asks for its job and leaves the PNG or the clip. Answered by the command line, not a server. */
export const JOB_PATH = '/__mogshot/job';
export const PICTURE_PATH = '/__mogshot/picture';
