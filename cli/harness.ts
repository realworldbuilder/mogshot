import { CLASSIC_SCREEN_ASPECT, composeBackdrop } from '../src/render/backdrop';
import { encodeClip } from '../src/render/clip';
import { encodePng, unpremultiply } from '../src/render/export';
import { CharacterRenderer } from '../src/render/renderer';
import { type Drawn, type Job, JOB_PATH, PICTURE_PATH } from './job';
import { unpack } from './wire';

/*
 * The page the command line opens in Chrome: it draws one job at a time with the renderer
 * the site uses, the way the site's download button does.
 */

let renderer: CharacterRenderer | undefined;

function graphics(): string {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
}

async function shoot(): Promise<Drawn> {
  const job = unpack<Job>(new Uint8Array(await (await fetch(JOB_PATH)).arrayBuffer()));
  renderer ??= new CharacterRenderer(document.createElement('canvas'));
  renderer.setScene(job.scene);
  const { width, height } = job;
  const backdrop = composeBackdrop(job.backdrop, width, height, job.screen, job.classicScreen ? CLASSIC_SCREEN_ASPECT : undefined);
  renderer.setBackdrop(backdrop);
  const { clip } = job;
  if (clip) {
    const view = renderer;
    view.holdFraming(clip.framing);
    const pose = job.scene.pose;
    const bytes = await encodeClip({
      format: clip.format,
      width,
      height,
      fps: clip.fps,
      frames: clip.poses.length,
      frame: async (i) => {
        view.setPose({ meshes: clip.poses[i]!, bounds: clip.framing, pose });
        return view.renderImage(job.camera, { longSide: Math.max(width, height), aspect: width / height, tight: false });
      },
    });
    await fetch(PICTURE_PATH, { method: 'POST', body: bytes as BodyInit });
    return { width, height, frames: clip.poses.length, problems: renderer.problems, graphics: graphics() };
  }
  // With a backdrop the whole frame is the picture; a tight crop is for a character alone.
  const image = renderer.renderImage(job.camera, { longSide: Math.max(width, height), aspect: width / height, tight: job.tight && !backdrop });
  unpremultiply(image.pixels);
  const png = await encodePng(image);
  await fetch(PICTURE_PATH, { method: 'POST', body: png as BodyInit });
  return { width: image.width, height: image.height, problems: renderer.problems, graphics: graphics() };
}

declare global {
  interface Window {
    mogshot?: { shoot: typeof shoot };
  }
}
window.mogshot = { shoot };
