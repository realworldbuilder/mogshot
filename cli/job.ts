import type { CharacterScene } from '../src/character/scene';
import type { Image } from '../src/formats/blp';
import type { Backdrop } from '../src/render/backdrop';
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
}

export interface Drawn {
  width: number;
  height: number;
  /** What the renderer could not draw. */
  problems: string[];
  /** The graphics card as the browser names it. */
  graphics: string;
}

/** Where the page asks for its job and leaves the PNG. Answered by the command line, not a server. */
export const JOB_PATH = '/__mogshot/job';
export const PICTURE_PATH = '/__mogshot/picture';
