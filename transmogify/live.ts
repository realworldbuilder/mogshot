import type { CharacterScene, PoseResult } from '../src/character/scene';
import type { Image } from '../src/formats/blp';
import { type Backdrop, CLASSIC_SCREEN_ASPECT, composeBackdrop } from '../src/render/backdrop';
import { type Camera, CharacterRenderer, DEFAULT_CAMERA } from '../src/render/renderer';
import { unpack } from '../cli/wire';

/*
 * Transmogify's live view: the character the server built, drawn in the browser with
 * Mogshot's renderer, idling in its pose's animation. Drag to turn it, as on the game's
 * character select screen; scroll or pinch to zoom; drag with the right button, with shift
 * held, or with two fingers to slide the view.
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

/** The view as the page keeps it, in the spec's terms: degrees, the zoom (smaller is closer) and the pan. */
export interface View {
  yaw: number;
  zoom: number;
  panX: number;
  panY: number;
  /** Held on the face, showing this much of the character's height: the camera follows the head as it turns. */
  face?: number;
}

/** The closest and farthest the zoom goes. */
const NEAREST = 0.08;
const FARTHEST = 3;
/** The face framing's view: its half height is this share of the character's height, a head and shoulders. */
const FACE = 0.24;

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
  /** In the face framing: the share of the character's height the view's half height shows. */
  private faceSize: number | undefined;
  /** The face framing has moved the camera since the page was last told. */
  private aimed = false;

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
    this.camera = { ...this.camera, yaw: view.yaw * DEGREE, zoom: view.zoom, panX: view.panX ?? 0, panY: view.panY ?? 0 };
    this.faceSize = view.face;
    this.aimed = view.face !== undefined;
  }

  view(): View {
    // Kept between -180 and 180 degrees, as the page's angles are.
    let yaw = (this.camera.yaw / DEGREE) % 360;
    if (yaw > 180) yaw -= 360;
    if (yaw < -180) yaw += 360;
    const round = (n: number) => Number(n.toFixed(3));
    return {
      yaw: Math.round(yaw),
      zoom: round(this.camera.zoom),
      panX: round(this.camera.panX),
      panY: round(this.camera.panY),
      ...(this.faceSize !== undefined && { face: round(this.faceSize) }),
    };
  }

  /**
   * A close-up of the face, for a profile picture: the head in the middle, about a head and
   * shoulders tall. A character seen from behind is turned to face the camera, a little to one side.
   */
  face(): void {
    let yaw = this.camera.yaw;
    if (Math.abs(Math.atan2(Math.sin(yaw), Math.cos(yaw))) > 70 * DEGREE) yaw = 15 * DEGREE;
    this.camera.yaw = yaw;
    this.faceSize = FACE;
    this.spin = 0;
    this.aimed = true;
  }

  /** The whole character, as it starts. */
  fullBody(): void {
    this.faceSize = undefined;
    this.camera = { ...this.camera, zoom: 1, panX: 0, panY: 0 };
    this.spin = 0;
    this.changed(this.view());
  }

  /** Aim at the head, for the face framing: worked out again each frame, since turning moves the head across the view. */
  private aimAtFace(data: LiveScene) {
    const { min, max } = data.framing;
    // The helm point sits in the middle of the head; without one, the head is near the top of the box.
    const head = data.scene.head ?? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2] - (max[2] - min[2]) * 0.08];
    const tall = Math.max(head[2] - min[2], 0.1);
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    // A little below the helm point, at the eyes and mouth.
    const at: [number, number, number] = [head[0], head[1], head[2] - tall * 0.03];
    this.camera = this.renderer.aimAt(this.camera, at, tall * this.faceSize!, aspect);
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
    if (this.faceSize !== undefined) {
      this.aimAtFace(data);
      // Once the camera is aimed at a new look's head, the page keeps those numbers for Save.
      if (this.aimed && !this.dragging) {
        this.aimed = false;
        this.changed(this.view());
      }
    }
    this.renderer.render(this.camera);
  };

  private dragging = false;

  private handle() {
    const { canvas } = this;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    let lastMove = 0;
    /** This drag slides the view rather than turning the character. */
    let panning = false;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.dragging = true;
      this.spin = 0;
      lastMove = event.timeStamp;
      panning = event.button === 1 || event.button === 2 || event.shiftKey;
      if (pointers.size === 2) pinch = distance();
    });
    canvas.addEventListener('pointermove', (event) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      if (pointers.size === 1 && panning) this.panBy(dx, dy);
      else if (pointers.size === 1) {
        this.camera.yaw -= dx * TURN;
        const dt = Math.max(event.timeStamp - lastMove, 1);
        this.spin = (-dx * TURN) / dt;
        lastMove = event.timeStamp;
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        // Two fingers: the gap zooms, and moving them together slides the view (half each, one event a finger).
        this.panBy(dx / 2, dy / 2);
        const now = distance();
        if (pinch > 0) this.zoomBy(now / pinch);
        pinch = now;
      }
    });
    const end = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return;
      if (pointers.size === 0) {
        this.dragging = false;
        if (panning) this.spin = 0;
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
      this.faceSize = undefined;
      this.camera = { ...this.camera, yaw: 0, zoom: 1, panX: 0, panY: 0 };
      this.spin = 0;
      this.changed(this.view());
    });
    function distance() {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }
  }

  /** Spreading fingers or scrolling up (a factor over 1) comes closer. */
  private zoomBy(factor: number) {
    // On the face, zooming keeps the head in the middle.
    if (this.faceSize !== undefined) this.faceSize = Math.min(1.2, Math.max(0.08, this.faceSize / factor));
    else this.camera.zoom = Math.min(FARTHEST, Math.max(NEAREST, this.camera.zoom / factor));
  }

  /** Slide the view with the pointer: what is under it stays under it. */
  private panBy(dx: number, dy: number) {
    // Moving the view by hand lets go of the face.
    this.faceSize = undefined;
    const height = Math.max(this.canvas.clientHeight, 1);
    this.camera.panX += (dx * 2) / height;
    this.camera.panY -= (dy * 2) / height;
  }
}
