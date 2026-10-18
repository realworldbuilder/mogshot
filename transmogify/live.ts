import type { CharacterScene, PoseResult } from '../src/character/scene';
import type { Image } from '../src/formats/blp';
import { type Backdrop, CLASSIC_SCREEN_ASPECT, composeBackdrop } from '../src/render/backdrop';
import { type Camera, CharacterRenderer, DEFAULT_CAMERA } from '../src/render/renderer';
import { unpack } from '../cli/wire';

/*
 * Transmogify's live view: the character the server built, drawn in the browser with
 * Mogshot's renderer, idling in its pose's animation. Drag to turn it, as on the game's
 * character select screen; scroll or pinch to zoom.
 */

interface LiveScene {
  scene: CharacterScene;
  poses: PoseResult['meshes'][];
  framing: CharacterScene['bounds'];
  fps: number;
  backdrop: Backdrop;
  screen?: Image;
  classicScreen: boolean;
}

/** The view's angle as the page keeps it: degrees, and the zoom. */
export interface View {
  yaw: number;
  zoom: number;
}

const DEGREE = Math.PI / 180;
/** Radians a pixel of drag turns the character. */
const TURN = 0.6 * DEGREE;

export function webglWorks(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export class Live {
  private renderer: CharacterRenderer;
  private data: LiveScene | undefined;
  private camera: Camera = { ...DEFAULT_CAMERA };
  private started = 0;
  private shownFrame = -1;
  private backdropSize = '';
  /** Turning speed after a drag lets go, radians a millisecond. */
  private spin = 0;
  private lastTick = 0;
  private request = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** Told the angle when a drag or a zoom ends, to keep with the look. */
    private readonly changed: (view: View) => void,
  ) {
    this.renderer = new CharacterRenderer(canvas);
    this.handle();
    requestAnimationFrame(this.tick);
  }

  /** Load a built character and show it at an angle. */
  async show(url: string, view: View): Promise<void> {
    const mine = ++this.request;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The character could not be fetched (${response.status})`);
    const data = unpack<LiveScene>(new Uint8Array(await response.arrayBuffer()));
    if (mine !== this.request) return;
    this.data = data;
    this.renderer.setScene(data.scene);
    this.renderer.holdFraming(data.framing);
    this.backdropSize = '';
    this.shownFrame = -1;
    this.started = performance.now();
    this.setView(view);
  }

  setView(view: View): void {
    this.camera = { ...this.camera, yaw: view.yaw * DEGREE, zoom: view.zoom };
  }

  private view(): View {
    // Kept between -180 and 180 degrees, as the page's angles are.
    let yaw = (this.camera.yaw / DEGREE) % 360;
    if (yaw > 180) yaw -= 360;
    if (yaw < -180) yaw += 360;
    return { yaw: Math.round(yaw), zoom: Number(this.camera.zoom.toFixed(2)) };
  }

  private tick = (now: number) => {
    requestAnimationFrame(this.tick);
    const data = this.data;
    if (!data) return;
    const { canvas } = this;
    // The canvas matches its box on screen, in device pixels.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const size = `${width}x${height}`;
    if (size !== this.backdropSize) {
      this.backdropSize = size;
      this.renderer.setBackdrop(composeBackdrop(data.backdrop, width, height, data.screen, data.classicScreen ? CLASSIC_SCREEN_ASPECT : undefined));
    }
    if (data.poses.length > 0) {
      const frame = Math.floor(((now - this.started) / 1000) * data.fps) % data.poses.length;
      if (frame !== this.shownFrame) {
        this.shownFrame = frame;
        this.renderer.setPose({ meshes: data.poses[frame]!, bounds: data.framing, pose: data.scene.pose });
      }
    }
    // A flick keeps turning a little and slows down.
    const elapsed = this.lastTick ? Math.min(now - this.lastTick, 50) : 16;
    this.lastTick = now;
    if (Math.abs(this.spin) > 0.00002 && !this.dragging) {
      this.camera.yaw += this.spin * elapsed;
      this.spin *= Math.pow(0.992, elapsed);
      if (Math.abs(this.spin) <= 0.00002) this.changed(this.view());
    }
    this.renderer.render(this.camera);
  };

  private dragging = false;

  private handle() {
    const { canvas } = this;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    let lastMove = 0;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.dragging = true;
      this.spin = 0;
      lastMove = event.timeStamp;
      if (pointers.size === 2) pinch = distance();
    });
    canvas.addEventListener('pointermove', (event) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      if (pointers.size === 1) {
        const dx = event.clientX - last.x;
        this.camera.yaw -= dx * TURN;
        const dt = Math.max(event.timeStamp - lastMove, 1);
        this.spin = (-dx * TURN) / dt;
        lastMove = event.timeStamp;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const now = distance();
        if (pinch > 0) this.zoomBy(now / pinch);
        pinch = now;
      }
    });
    const end = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (pointers.size === 0) {
        this.dragging = false;
        // Held still before letting go: no flick.
        if (event.timeStamp - lastMove > 80) this.spin = 0;
        this.changed(this.view());
      }
      pinch = 0;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    let wheelDone: ReturnType<typeof setTimeout> | undefined;
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.zoomBy(Math.exp(-event.deltaY * 0.002));
        clearTimeout(wheelDone);
        wheelDone = setTimeout(() => this.changed(this.view()), 300);
      },
      { passive: false },
    );
    canvas.addEventListener('dblclick', () => {
      this.camera = { ...this.camera, yaw: 0, zoom: 1 };
      this.spin = 0;
      this.changed(this.view());
    });
    function distance() {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }
  }

  private zoomBy(factor: number) {
    this.camera.zoom = Math.min(3, Math.max(0.4, this.camera.zoom * factor));
  }
}
