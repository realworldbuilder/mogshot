import type { CharacterScene, PoseResult, SceneDraw, SceneMesh } from '../character/scene';
import { VERTEX_SIZE } from '../formats/m2';
import type { Image } from '../formats/blp';
import { invert, lookAt, type Mat4, multiply, perspective, transformPoint } from '../math/mat4';
import { alphaBounds } from './export';
import { PLACE_VERTEX_SIZE, type PlaceDraw, type PlaceScene, type TerrainMesh } from '../world/place';
import { combiners } from './shader-table';
import {
  BACKDROP_FRAGMENT_SOURCE, BACKDROP_VERTEX_SOURCE, DOWNSAMPLE_FRAGMENT_SOURCE, DOWNSAMPLE_VERTEX_SOURCE, FRAGMENT_SOURCE,
  FOCUS_FRAGMENT_SOURCE, PLACE_FRAGMENT_SOURCE, PLACE_VERTEX_SOURCE, SKY_FRAGMENT_SOURCE, SKY_VERTEX_SOURCE, TERRAIN_FRAGMENT_SOURCE,
  VERTEX_SOURCE,
} from './shaders';

/** Where the camera is, as an orbit around the character. Angles in radians. */
export interface Camera {
  /** Rotation around the vertical axis; 0 looks at the character's front. */
  yaw: number;
  /** Elevation above the horizontal. */
  pitch: number;
  /** Vertical field of view. */
  fov: number;
  /** 1 fits the character in the frame with a small margin; larger is further away. */
  zoom: number;
  /** Shift of the view across and up the frame, in half frame heights. */
  panX: number;
  panY: number;
}

export const DEFAULT_CAMERA: Camera = { yaw: 0, pitch: 0, fov: (30 * Math.PI) / 180, zoom: 1, panX: 0, panY: 0 };

export interface ImageOptions {
  /** Size of the longer side in pixels. */
  longSide: number;
  /** Width over height of the frame, used when not cropping. */
  aspect: number;
  /** Frame the picture tightly around the character instead of using `aspect`. */
  tight: boolean;
}

/** Samples a picture may use in total, to stay within the memory of ordinary graphics cards. */
const MAX_SAMPLES = 64_000_000;

/** Part of the camera's view, in its -1..1 coordinates (y up). */
interface Frame {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const FULL_FRAME: Frame = { x0: -1, x1: 1, y0: -1, y1: 1 };

/** One mesh's buffers on the graphics card. */
interface GpuMesh {
  vao: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  boneTexture: WebGLTexture;
  transform: Float32Array;
  bones: Float32Array;
  billboards: SceneMesh['billboards'];
}

/** The camera's directions in the world, for aiming billboards. */
interface CameraAxes {
  toCamera: readonly [number, number, number];
  right: readonly [number, number, number];
  up: readonly [number, number, number];
  /** Tangents of half the field of view, across and up. */
  tan: readonly [number, number];
}

interface PreparedDraw {
  mesh: GpuMesh;
  draw: SceneDraw;
  vertexShader: number;
  pixelShader: number;
}

/** A place's buffers on the graphics card. */
interface GpuPlace {
  terrain: { vao: WebGLVertexArrayObject; vertexBuffer: WebGLBuffer; indexBuffer: WebGLBuffer; blend: WebGLTexture; transform: Float32Array; draws: TerrainMesh['draws'] }[];
  meshes: {
    vao: WebGLVertexArrayObject;
    vertexBuffer: WebGLBuffer;
    indexBuffer: WebGLBuffer;
    outdoors: boolean;
    baked: boolean;
    transform: Float32Array;
    draws: PlaceDraw[];
  }[];
  textures: WebGLTexture[];
  /** Each prop model once, its batches ready to draw, and where its copies stand. */
  props: { mesh: GpuMesh; draws: PreparedDraw[] }[];
  propTextures: WebGLTexture[];
  instances: { prop: number; transform: Float32Array }[];
  reach: number;
}

/** The haze the world fades into and the sky meets the horizon in, and the sky overhead. */
const HAZE = [0.66, 0.74, 0.82] as const;
const ZENITH = [0.27, 0.47, 0.76] as const;

/** The widest the depth-of-field blur gets at full strength, as a part of the picture's height. */
const FOCUS_BLUR = 0.014;

/** Toward a mid-morning sun, in the character's space. */
const SUN = /* @__PURE__ */ (() => {
  const sun = [0.35, 0.45, 0.82] as const;
  const length = Math.hypot(...sun);
  return [sun[0] / length, sun[1] / length, sun[2] / length] as const;
})();

/** A direction turned by a matrix's rotation. */
function transformDirection(m: Mat4, d: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]! * d[0] + m[4]! * d[1] + m[8]! * d[2],
    m[1]! * d[0] + m[5]! * d[1] + m[9]! * d[2],
    m[2]! * d[0] + m[6]! * d[1] + m[10]! * d[2],
  ];
}

const UNIFORMS = [
  'u_view', 'u_projection', 'u_model', 'u_bones', 'u_vertex_shader', 'u_pixel_shader', 'u_blend_mode', 'u_unlit', 'u_haze', 'u_reach',
  'u_ambient', 'u_light_color', 'u_light_direction', 'u_texture1', 'u_texture2', 'u_texture3', 'u_texture4',
] as const;

/** Draws one character scene into a canvas, over a transparent background or a backdrop picture. */
export class CharacterRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly downsample: WebGLProgram;
  private readonly backdropProgram: WebGLProgram;
  private backdrop: WebGLTexture | undefined;
  private readonly placeProgram: WebGLProgram;
  private readonly terrainProgram: WebGLProgram;
  private readonly skyProgram: WebGLProgram;
  private readonly focusProgram: WebGLProgram;
  private readonly shadowQuad: WebGLVertexArrayObject;
  /** How strongly the world behind the character is blurred, 0 to 1. Only a place has depth to blur. */
  private focus = 0.5;
  private place: GpuPlace | undefined;
  private readonly uniforms = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly white: WebGLTexture;
  private meshes: GpuMesh[] = [];
  private textures: WebGLTexture[] = [];
  private draws: PreparedDraw[] = [];
  private hidden = false;
  private bounds: CharacterScene['bounds'] = { min: [0, 0, 0], max: [0, 0, 0] };
  /** The box the camera frames while a clip plays, in place of each pose's own. */
  private framing: CharacterScene['bounds'] | undefined;
  /** Problems found while preparing the scene for drawing (unknown shaders and the like). */
  problems: string[] = [];
  /** Problems found while preparing the place. */
  placeProblems: string[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) throw new Error('This browser cannot create a WebGL2 context');
    this.gl = gl;
    this.program = link(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
    this.downsample = link(gl, DOWNSAMPLE_VERTEX_SOURCE, DOWNSAMPLE_FRAGMENT_SOURCE);
    this.backdropProgram = link(gl, BACKDROP_VERTEX_SOURCE, BACKDROP_FRAGMENT_SOURCE);
    this.placeProgram = link(gl, PLACE_VERTEX_SOURCE, PLACE_FRAGMENT_SOURCE);
    this.terrainProgram = link(gl, PLACE_VERTEX_SOURCE, TERRAIN_FRAGMENT_SOURCE);
    this.skyProgram = link(gl, SKY_VERTEX_SOURCE, SKY_FRAGMENT_SOURCE);
    this.focusProgram = link(gl, DOWNSAMPLE_VERTEX_SOURCE, FOCUS_FRAGMENT_SOURCE);

    // A flat square from -1 to 1 for the character's shadow, laid out as a place's vertices.
    const corners = new Float32Array(4 * (PLACE_VERTEX_SIZE / 4));
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([x, y], i) => corners.set([x!, y!, 0, 0, 0, 1, (x! + 1) / 2, (y! + 1) / 2], i * (PLACE_VERTEX_SIZE / 4)));
    this.shadowQuad = gl.createVertexArray()!;
    gl.bindVertexArray(this.shadowQuad);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, PLACE_VERTEX_SIZE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, PLACE_VERTEX_SIZE, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, PLACE_VERTEX_SIZE, 24);
    gl.bindVertexArray(null);
    for (const name of UNIFORMS) this.uniforms[name] = gl.getUniformLocation(this.program, name);

    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }

  setScene(scene: CharacterScene): void {
    const { gl } = this;
    this.problems = [];
    this.bounds = scene.bounds;
    this.framing = undefined;

    for (const mesh of this.meshes) {
      gl.deleteVertexArray(mesh.vao);
      gl.deleteBuffer(mesh.vertexBuffer);
      gl.deleteBuffer(mesh.indexBuffer);
      gl.deleteTexture(mesh.boneTexture);
    }
    this.meshes = scene.meshes.map((mesh) => this.uploadMesh(mesh));

    for (const texture of this.textures) gl.deleteTexture(texture);
    this.textures = scene.textures.map((image) => this.upload(image));

    const prepared: PreparedDraw[] = [];
    scene.meshes.forEach((mesh, meshIndex) => prepared.push(...this.prepare(mesh, this.meshes[meshIndex]!, this.problems)));
    this.draws = inOrder(prepared);
  }

  /** A mesh's batches with the shaders each uses; a batch with a shader this app does not know is named and left out. */
  private prepare(mesh: SceneMesh, gpu: GpuMesh, problems: string[]): PreparedDraw[] {
    const prepared: PreparedDraw[] = [];
    for (const draw of mesh.draws) {
      const shaders = combiners(draw.shaderId, draw.textureCount);
      if (!shaders) {
        problems.push(`Geoset ${draw.sectionId} uses a shader this app does not know (${draw.shaderId})`);
        continue;
      }
      prepared.push({ mesh: gpu, draw, vertexShader: shaders.vertex, pixelShader: shaders.pixel });
    }
    return prepared;
  }

  /** A model's vertices, triangles and bones on the graphics card. */
  private uploadMesh(mesh: SceneMesh): GpuMesh {
    const { gl } = this;
    const vao = gl.createVertexArray()!;
    const vertexBuffer = gl.createBuffer()!;
    const indexBuffer = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    // The model's 48-byte vertex, used as stored.
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_SIZE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, VERTEX_SIZE, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_BYTE, VERTEX_SIZE, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, VERTEX_SIZE, 20);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, VERTEX_SIZE, 32);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 2, gl.FLOAT, false, VERTEX_SIZE, 40);
    gl.bindVertexArray(null);

    // One bone per row, four texels wide.
    const boneTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, boneTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const rows = Math.max(1, mesh.bones.length / 16);
    const matrices = mesh.bones.length > 0 ? mesh.bones : new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, rows, 0, gl.RGBA, gl.FLOAT, matrices);
    return { vao, vertexBuffer, indexBuffer, boneTexture, transform: mesh.transform, bones: mesh.bones, billboards: mesh.billboards };
    }

  /** A texture with mipmaps, wrapping as the image says. */
  private upload(image: CharacterScene['textures'][number]): WebGLTexture {
    const { gl } = this;
    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.pixels);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, image.wrapX ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, image.wrapY ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    if (anisotropy) {
      const max = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
    return texture;
  }

  /**
   * The picture drawn behind the character, filling the frame, or none for a transparent
   * background. It is stretched to the frame, so compose it in the picture's shape.
   */
  setBackdrop(source: TexImageSource | undefined): void {
    const { gl } = this;
    if (this.backdrop) gl.deleteTexture(this.backdrop);
    this.backdrop = undefined;
    if (!source) return;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.backdrop = texture;
  }

  /** How strongly the world behind the character is blurred in a place: 0 for none, 1 for the most. */
  setFocus(strength: number): void {
    this.focus = Math.min(1, Math.max(0, strength));
  }

  /** The world drawn around the character, or none. The character stands at the place's spot. */
  setPlace(place: PlaceScene | undefined): void {
    const { gl } = this;
    if (this.place) {
      for (const mesh of [...this.place.meshes, ...this.place.terrain]) {
        gl.deleteVertexArray(mesh.vao);
        gl.deleteBuffer(mesh.vertexBuffer);
        gl.deleteBuffer(mesh.indexBuffer);
      }
      for (const mesh of this.place.terrain) gl.deleteTexture(mesh.blend);
      for (const { mesh } of this.place.props) {
        gl.deleteVertexArray(mesh.vao);
        gl.deleteBuffer(mesh.vertexBuffer);
        gl.deleteBuffer(mesh.indexBuffer);
        gl.deleteTexture(mesh.boneTexture);
      }
      for (const texture of [...this.place.textures, ...this.place.propTextures]) gl.deleteTexture(texture);
    }
    this.place = undefined;
    this.placeProblems = [];
    if (!place) return;
    const buffers = (mesh: { vertices: Uint8Array; indices: Uint16Array }) => {
      const vao = gl.createVertexArray()!;
      const vertexBuffer = gl.createBuffer()!;
      const indexBuffer = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, PLACE_VERTEX_SIZE, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, PLACE_VERTEX_SIZE, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, PLACE_VERTEX_SIZE, 24);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, PLACE_VERTEX_SIZE, 32);
      gl.bindVertexArray(null);
      return { vao, vertexBuffer, indexBuffer };
    };
    const meshes = place.meshes.map((mesh) => ({ ...buffers(mesh), outdoors: mesh.outdoors, baked: mesh.baked, transform: mesh.transform, draws: mesh.draws }));
    const terrain = place.terrain.map((mesh) => ({
      ...buffers(mesh),
      blend: this.upload({ ...mesh.blend, wrapX: false, wrapY: false }),
      transform: mesh.transform,
      draws: mesh.draws,
    }));
    // A prop with a shader this app does not know is drawn without that batch; one line says how many.
    const unknown: string[] = [];
    const props = place.props.map((prop) => {
      const mesh = this.uploadMesh(prop);
      return { mesh, draws: inOrder(this.prepare(prop, mesh, unknown)) };
    });
    this.placeProblems = unknown.length > 0 ? [`${unknown.length} parts of props in the place use shaders this app does not know and are not drawn`] : [];
    this.place = {
      terrain,
      meshes,
      textures: place.textures.map((image) => this.upload(image)),
      props,
      propTextures: place.propTextures.map((image) => this.upload(image)),
      instances: place.instances,
      reach: place.reach,
    };
  }

  /** Move the scene's meshes to a new pose (see CharacterRig.pose). */
  setPose(pose: PoseResult): void {
    const { gl } = this;
    this.bounds = pose.bounds;
    pose.meshes.forEach((meshPose, i) => {
      const mesh = this.meshes[i];
      if (!mesh || meshPose.bones.length !== mesh.bones.length) return;
      mesh.bones = meshPose.bones;
      mesh.transform = meshPose.transform;
      if (mesh.bones.length === 0) return;
      gl.bindTexture(gl.TEXTURE_2D, mesh.boneTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, mesh.bones.length / 16, gl.RGBA, gl.FLOAT, mesh.bones);
    });
  }

  /**
   * Keep the camera framed on one box while the pose changes, so a playing animation does
   * not make the view breathe with it. Without a box, each pose is framed on its own again.
   */
  holdFraming(bounds: CharacterScene['bounds'] | undefined): void {
    this.framing = bounds;
  }

  /** Leave the character and its shadow out: a place with nobody in it. The camera is framed as if it were there. */
  hideCharacter(hidden: boolean): void {
    this.hidden = hidden;
  }

  /** Draw the scene to the canvas. The canvas's pixel size is used as it is. */
  render(camera: Camera = DEFAULT_CAMERA): void {
    const { gl, canvas } = this;
    if (this.place) {
      // A place is drawn to a picture first, so that its depth can be read to blur the distance.
      this.drawOffscreen(camera, canvas.width / canvas.height, FULL_FRAME, canvas.width, canvas.height, 1, true);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const { view, projection, axes } = this.cameraMatrices(camera, canvas.width / canvas.height);
    this.draw(view, projection, axes, FULL_FRAME, canvas.width, canvas.height);
  }

  /**
   * Draw the scene to an image of any size, supersampled. The result is premultiplied
   * RGBA with rows top to bottom; convert it with `unpremultiply` before saving.
   */
  renderImage(camera: Camera, options: ImageOptions): Image {
    let aspect = options.aspect;
    let frame = FULL_FRAME;
    if (options.tight) {
      // Find the character in a small draft, then aim the full-size picture at just that part.
      const draftWidth = aspect >= 1 ? 512 : Math.round(512 * aspect);
      const draftHeight = aspect >= 1 ? Math.round(512 / aspect) : 512;
      const draft = this.drawOffscreen(camera, aspect, frame, draftWidth, draftHeight);
      const box = alphaBounds(draft);
      if (box) {
        const pad = 3;
        const left = Math.max(0, box.x - pad);
        const top = Math.max(0, box.y - pad);
        const right = Math.min(draftWidth, box.x + box.width + pad);
        const bottom = Math.min(draftHeight, box.y + box.height + pad);
        frame = {
          x0: (left / draftWidth) * 2 - 1,
          x1: (right / draftWidth) * 2 - 1,
          y0: 1 - (bottom / draftHeight) * 2,
          y1: 1 - (top / draftHeight) * 2,
        };
        // The frame is a crop of the full view, so the camera keeps the full view's aspect.
        const cropAspect = (right - left) / (bottom - top);
        const width = cropAspect >= 1 ? options.longSide : Math.round(options.longSide * cropAspect);
        const height = cropAspect >= 1 ? Math.round(options.longSide / cropAspect) : options.longSide;
        return this.drawOffscreen(camera, aspect, frame, width, height);
      }
    }
    const width = aspect >= 1 ? options.longSide : Math.round(options.longSide * aspect);
    const height = aspect >= 1 ? Math.round(options.longSide / aspect) : options.longSide;
    aspect = width / height;
    return this.drawOffscreen(camera, aspect, frame, width, height);
  }

  /**
   * Render the part of the camera's view inside `frame` to a width x height image, each
   * pixel the average of up to `detail` x `detail` samples; or straight onto the canvas.
   */
  private drawOffscreen(camera: Camera, aspect: number, frame: Frame, width: number, height: number): Image;
  private drawOffscreen(camera: Camera, aspect: number, frame: Frame, width: number, height: number, detail: number, toCanvas: true): undefined;
  private drawOffscreen(camera: Camera, aspect: number, frame: Frame, width: number, height: number, detail = 3, toCanvas = false): Image | undefined {
    const { gl } = this;
    const limit = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE)) as number;
    if (width > limit || height > limit) throw new Error(`This graphics card cannot draw a picture larger than ${limit} pixels`);
    // Supersample as much as fits: each output pixel is the average of factor x factor samples.
    let factor = detail;
    while (factor > 1 && (width * factor > limit || height * factor > limit || width * height * factor * factor > MAX_SAMPLES)) factor--;
    const bigWidth = width * factor;
    const bigHeight = height * factor;
    let samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
    while (samples > 1 && bigWidth * bigHeight * samples > MAX_SAMPLES) samples >>= 1;

    const { view, projection, axes, near, far, distance } = this.cameraMatrices(camera, aspect);
    // Zoom the projection so that `frame` (in the full view's -1..1 coordinates) fills the picture.
    const sx = 2 / (frame.x1 - frame.x0);
    const sy = 2 / (frame.y1 - frame.y0);
    const tx = -(frame.x1 + frame.x0) / (frame.x1 - frame.x0);
    const ty = -(frame.y1 + frame.y0) / (frame.y1 - frame.y0);
    for (let column = 0; column < 4; column++) {
      projection[column * 4] = sx * projection[column * 4]! + tx * projection[column * 4 + 3]!;
      projection[column * 4 + 1] = sy * projection[column * 4 + 1]! + ty * projection[column * 4 + 3]!;
    }

    const color = gl.createRenderbuffer();
    const depth = gl.createRenderbuffer();
    const drawBuffer = gl.createFramebuffer();
    const resolved = gl.createTexture();
    const resolveBuffer = gl.createFramebuffer();
    const output = gl.createTexture();
    const outputBuffer = gl.createFramebuffer();
    const depthTexture = gl.createTexture();
    const focused = gl.createTexture();
    const focusedBuffer = gl.createFramebuffer();
    try {
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, bigWidth, bigHeight);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, bigWidth, bigHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, drawBuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('The graphics card could not allocate the picture');
      }
      this.draw(view, projection, axes, frame, bigWidth, bigHeight);

      const target = (texture: WebGLTexture | null, buffer: WebGLFramebuffer | null, w: number, h: number) => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      };
      // Resolve the multisampled buffer, then average it down to the output size.
      target(resolved, resolveBuffer, bigWidth, bigHeight);
      const place = this.place !== undefined;
      if (place) {
        // The depth comes along, to tell the blur how far away each pixel is.
        gl.bindTexture(gl.TEXTURE_2D, depthTexture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, bigWidth, bigHeight);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0);
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, drawBuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolveBuffer);
      gl.blitFramebuffer(0, 0, bigWidth, bigHeight, 0, 0, bigWidth, bigHeight, gl.COLOR_BUFFER_BIT | (place ? gl.DEPTH_BUFFER_BIT : 0), gl.NEAREST);

      target(output, outputBuffer, width, height);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.downsample);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resolved);
      gl.uniform1i(gl.getUniformLocation(this.downsample, 'u_source'), 0);
      gl.uniform1i(gl.getUniformLocation(this.downsample, 'u_factor'), factor);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (place) {
        // Blur by distance, into a last picture or onto the canvas.
        if (toCanvas) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        else target(focused, focusedBuffer, width, height);
        const { focusProgram } = this;
        const at = (name: string) => gl.getUniformLocation(focusProgram, name);
        gl.useProgram(focusProgram);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, depthTexture);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, output);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(at('u_color'), 0);
        gl.uniform1i(at('u_depth'), 1);
        gl.uniform2f(at('u_size'), width, height);
        gl.uniform1f(at('u_near'), near);
        gl.uniform1f(at('u_far'), far);
        gl.uniform1f(at('u_focus'), distance);
        gl.uniform1f(at('u_blur'), this.focus * FOCUS_BLUR * height);
        gl.viewport(0, 0, width, height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (toCanvas) return undefined;

      const bottomUp = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
      const pixels = new Uint8Array(bottomUp.length);
      const stride = width * 4;
      for (let y = 0; y < height; y++) {
        pixels.set(bottomUp.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
      }
      return { width, height, pixels };
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(drawBuffer);
      gl.deleteFramebuffer(resolveBuffer);
      gl.deleteFramebuffer(outputBuffer);
      gl.deleteRenderbuffer(color);
      gl.deleteRenderbuffer(depth);
      gl.deleteTexture(resolved);
      gl.deleteTexture(output);
      gl.deleteTexture(depthTexture);
      gl.deleteTexture(focused);
      gl.deleteFramebuffer(focusedBuffer);
    }
  }

  /** Draw the backdrop, if any, and the scene into the bound framebuffer. */
  private draw(view: Mat4, projection: Mat4, axes: CameraAxes, frame: Frame, width: number, height: number): void {
    const { gl, uniforms } = this;
    gl.viewport(0, 0, width, height);
    // A place fills the frame: its haze is the sky where nothing stands.
    if (this.place) gl.clearColor(HAZE[0], HAZE[1], HAZE[2], 1);
    else gl.clearColor(0, 0, 0, 0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.backdrop) {
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.backdropProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.backdrop);
      gl.uniform1i(gl.getUniformLocation(this.backdropProgram, 'u_backdrop'), 0);
      gl.uniform4f(gl.getUniformLocation(this.backdropProgram, 'u_frame'), frame.x0, frame.y0, frame.x1, frame.y1);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (this.place) {
      if (!this.backdrop) this.drawSky(axes, frame);
      this.drawPlace(this.place, view, projection);
    }
    if (this.draws.length === 0 && !this.place) return;

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(uniforms.u_view, false, view);
    gl.uniformMatrix4fv(uniforms.u_projection, false, projection);

    gl.uniform1i(uniforms.u_bones, 4);
    gl.uniform1i(uniforms.u_texture1, 0);
    gl.uniform1i(uniforms.u_texture2, 1);
    gl.uniform1i(uniforms.u_texture3, 2);
    gl.uniform1i(uniforms.u_texture4, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    if (this.place) {
      // Props: lit by the place's sun, fading into its haze.
      const sun = transformDirection(view, SUN);
      gl.uniform3f(uniforms.u_ambient, 0.5, 0.52, 0.58);
      gl.uniform3f(uniforms.u_light_color, 0.7, 0.66, 0.58);
      gl.uniform3f(uniforms.u_light_direction, -sun[0], -sun[1], -sun[2]);
      gl.uniform3f(uniforms.u_haze, HAZE[0], HAZE[1], HAZE[2]);
      gl.uniform1f(uniforms.u_reach, this.place.reach);
      const { props, propTextures, instances } = this.place;
      for (const blended of [false, true]) {
        for (const instance of instances) {
          const prop = props[instance.prop]!;
          prop.mesh.transform = instance.transform;
          let aimed = false;
          for (const draw of prop.draws) {
            if (draw.draw.blendMode > 1 !== blended) continue;
            // The bones are shared by every copy, so billboards are aimed for the copy being drawn.
            if (!aimed) this.aimBillboards(prop.mesh, axes);
            aimed = true;
            this.drawBatch(draw, propTextures);
          }
        }
      }
    }

    if (this.place) {
      // In a place the character is lit by its sun, with the shade filled in so the dark side still reads.
      const sun = transformDirection(view, SUN);
      gl.uniform3f(uniforms.u_ambient, 0.62, 0.63, 0.66);
      gl.uniform3f(uniforms.u_light_color, 0.55, 0.52, 0.46);
      gl.uniform3f(uniforms.u_light_direction, -sun[0], -sun[1], -sun[2]);
    } else {
      // A light from in front of and above the character, slightly to one side, fixed to the camera.
      gl.uniform3f(uniforms.u_ambient, 0.55, 0.55, 0.55);
      gl.uniform3f(uniforms.u_light_color, 0.6, 0.6, 0.6);
      gl.uniform3f(uniforms.u_light_direction, 0.35, -0.5, -0.8);
    }
    gl.uniform1f(uniforms.u_reach, 0);
    for (const mesh of this.meshes) this.aimBillboards(mesh, axes);
    if (!this.hidden) for (const draw of this.draws) this.drawBatch(draw, this.textures);

    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** Draw one batch of a model with the model program, which is in use with its camera and light set. */
  private drawBatch({ mesh, draw, vertexShader, pixelShader }: PreparedDraw, textures: WebGLTexture[]): void {
    const { gl, uniforms } = this;
    gl.bindVertexArray(mesh.vao);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, mesh.boneTexture);
    gl.uniformMatrix4fv(uniforms.u_model, false, mesh.transform);
    gl.uniform1i(uniforms.u_vertex_shader, vertexShader);
    gl.uniform1i(uniforms.u_pixel_shader, pixelShader);
    gl.uniform1i(uniforms.u_blend_mode, draw.blendMode);
    gl.uniform1i(uniforms.u_unlit, draw.materialFlags & 0x1 ? 1 : 0);

    if (draw.materialFlags & 0x4) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
    if (draw.materialFlags & 0x8) gl.disable(gl.DEPTH_TEST);
    else gl.enable(gl.DEPTH_TEST);
    gl.depthMask((draw.materialFlags & 0x10) === 0);
    this.applyBlend(draw.blendMode);

    for (let stage = 0; stage < 4; stage++) {
      gl.activeTexture(gl.TEXTURE0 + stage);
      gl.bindTexture(gl.TEXTURE_2D, textures[draw.textures[stage] ?? -1] ?? this.white);
    }
    gl.drawElements(gl.TRIANGLES, draw.indexCount, gl.UNSIGNED_SHORT, draw.indexStart * 2);
  }

  /** Fill the frame with the sky as the camera sees it. */
  private drawSky(axes: CameraAxes, frame: Frame): void {
    const { gl, skyProgram } = this;
    const at = (name: string) => gl.getUniformLocation(skyProgram, name);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(skyProgram);
    gl.uniform4f(at('u_frame'), frame.x0, frame.y0, frame.x1, frame.y1);
    gl.uniform3f(at('u_forward'), -axes.toCamera[0], -axes.toCamera[1], -axes.toCamera[2]);
    gl.uniform3f(at('u_right'), axes.right[0], axes.right[1], axes.right[2]);
    gl.uniform3f(at('u_up'), axes.up[0], axes.up[1], axes.up[2]);
    gl.uniform2f(at('u_tan'), axes.tan[0], axes.tan[1]);
    gl.uniform3f(at('u_haze'), HAZE[0], HAZE[1], HAZE[2]);
    gl.uniform3f(at('u_zenith'), ZENITH[0], ZENITH[1], ZENITH[2]);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draw the ground of a place. */
  private drawTerrain(place: GpuPlace, view: Mat4, projection: Mat4): void {
    const { gl, terrainProgram } = this;
    const at = (name: string) => gl.getUniformLocation(terrainProgram, name);
    gl.useProgram(terrainProgram);
    gl.uniformMatrix4fv(at('u_view'), false, view);
    gl.uniformMatrix4fv(at('u_projection'), false, projection);
    gl.uniform3f(at('u_sun_direction'), SUN[0], SUN[1], SUN[2]);
    gl.uniform3f(at('u_sun_color'), 0.75, 0.7, 0.62);
    gl.uniform3f(at('u_ambient'), 0.42, 0.45, 0.52);
    gl.uniform3f(at('u_haze'), HAZE[0], HAZE[1], HAZE[2]);
    gl.uniform1f(at('u_reach'), place.reach);
    for (let layer = 0; layer < 4; layer++) gl.uniform1i(at(`u_layer${layer}`), layer);
    gl.uniform1i(at('u_blend'), 4);
    const model = at('u_model');
    const layers = at('u_layers');
    const chunk = at('u_chunk');
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    for (const mesh of place.terrain) {
      gl.bindVertexArray(mesh.vao);
      gl.uniformMatrix4fv(model, false, mesh.transform);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, mesh.blend);
      for (const draw of mesh.draws) {
        gl.uniform1i(layers, draw.layers.length);
        gl.uniform2f(chunk, draw.column, draw.row);
        for (let layer = 0; layer < 4; layer++) {
          gl.activeTexture(gl.TEXTURE0 + layer);
          gl.bindTexture(gl.TEXTURE_2D, place.textures[draw.layers[layer] ?? -1] ?? this.white);
        }
        gl.drawElements(gl.TRIANGLES, draw.indexCount, gl.UNSIGNED_SHORT, draw.indexStart * 2);
      }
    }
    gl.bindVertexArray(null);
  }

  /** Draw the world: solid surfaces first, then the blended ones over them. */
  private drawPlace(place: GpuPlace, view: Mat4, projection: Mat4): void {
    const { gl, placeProgram } = this;
    this.drawTerrain(place, view, projection);
    const at = (name: string) => gl.getUniformLocation(placeProgram, name);
    gl.useProgram(placeProgram);
    gl.uniformMatrix4fv(at('u_view'), false, view);
    gl.uniformMatrix4fv(at('u_projection'), false, projection);
    gl.uniform1i(at('u_texture'), 0);
    gl.uniform3f(at('u_sun_direction'), SUN[0], SUN[1], SUN[2]);
    gl.uniform3f(at('u_sun_color'), 0.75, 0.7, 0.62);
    gl.uniform3f(at('u_ambient'), 0.42, 0.45, 0.52);
    gl.uniform3f(at('u_haze'), HAZE[0], HAZE[1], HAZE[2]);
    gl.uniform1f(at('u_reach'), place.reach);
    const model = at('u_model');
    const outdoors = at('u_outdoors');
    const baked = at('u_baked');
    const water = at('u_water');
    const blendMode = at('u_blend_mode');
    const unlit = at('u_unlit');

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.activeTexture(gl.TEXTURE0);
    for (const blended of [false, true]) {
      gl.depthMask(!blended);
      if (blended) {
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        // The character's shadow lies on the solid ground, under any water or glass.
        if (this.draws.length > 0 && !this.hidden) {
          const { min, max } = this.framing ?? this.bounds;
          const radius = Math.max(max[0] - min[0], max[1] - min[1]) * 0.6;
          const shadow = new Float32Array([radius, 0, 0, 0, 0, radius, 0, 0, 0, 0, 1, 0, (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, 0, 1]);
          gl.bindVertexArray(this.shadowQuad);
          gl.uniformMatrix4fv(model, false, shadow);
          gl.uniform1i(at('u_shadow'), 1);
          gl.disable(gl.CULL_FACE);
          // Lifted a little toward the camera so it does not flicker against the ground it lies on.
          gl.enable(gl.POLYGON_OFFSET_FILL);
          gl.polygonOffset(-2, -8);
          gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
          gl.disable(gl.POLYGON_OFFSET_FILL);
          gl.uniform1i(at('u_shadow'), 0);
        }
      } else gl.disable(gl.BLEND);
      for (const mesh of place.meshes) {
        gl.bindVertexArray(mesh.vao);
        gl.uniformMatrix4fv(model, false, mesh.transform);
        gl.uniform1i(outdoors, mesh.outdoors ? 1 : 0);
        gl.uniform1i(baked, mesh.baked ? 1 : 0);
        for (const draw of mesh.draws) {
          if (draw.blendMode > 1 !== blended) continue;
          if (draw.twoSided) gl.disable(gl.CULL_FACE);
          else gl.enable(gl.CULL_FACE);
          gl.uniform1i(blendMode, draw.blendMode);
          gl.uniform1i(unlit, draw.unlit ? 1 : 0);
          gl.uniform1i(water, draw.water ? 1 : 0);
          gl.bindTexture(gl.TEXTURE_2D, place.textures[draw.texture] ?? this.white);
          gl.drawElements(gl.TRIANGLES, draw.indexCount, gl.UNSIGNED_SHORT, draw.indexStart * 2);
        }
      }
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /**
   * Turn a mesh's billboard bones to face the camera: each keeps its place and size, and
   * its forward axis (the model's +X) is pointed at the camera with its up axis upright.
   */
  private aimBillboards(mesh: GpuMesh, axes: CameraAxes): void {
    if (mesh.billboards.length === 0) return;
    const { gl } = this;
    const bones = mesh.bones.slice();
    const world = new Float32Array(16);
    const aimed = new Float32Array(16);
    const inverse = invert(new Float32Array(16), mesh.transform);
    for (const { bone, pivot } of mesh.billboards) {
      const matrix = bones.subarray(bone * 16, bone * 16 + 16);
      multiply(world, mesh.transform, matrix);
      const [x, y, z] = transformPoint(world, pivot);
      const sx = Math.hypot(world[0]!, world[1]!, world[2]!);
      const sy = Math.hypot(world[4]!, world[5]!, world[6]!);
      const sz = Math.hypot(world[8]!, world[9]!, world[10]!);
      // Columns: the bone's X toward the camera, Y to the camera's left, Z up the screen.
      aimed.set([
        axes.toCamera[0] * sx, axes.toCamera[1] * sx, axes.toCamera[2] * sx, 0,
        -axes.right[0] * sy, -axes.right[1] * sy, -axes.right[2] * sy, 0,
        axes.up[0] * sz, axes.up[1] * sz, axes.up[2] * sz, 0,
        0, 0, 0, 1,
      ]);
      // Keep the pivot where it was.
      aimed[12] = x - (aimed[0]! * pivot[0] + aimed[4]! * pivot[1] + aimed[8]! * pivot[2]);
      aimed[13] = y - (aimed[1]! * pivot[0] + aimed[5]! * pivot[1] + aimed[9]! * pivot[2]);
      aimed[14] = z - (aimed[2]! * pivot[0] + aimed[6]! * pivot[1] + aimed[10]! * pivot[2]);
      multiply(matrix, inverse, aimed);
    }
    gl.bindTexture(gl.TEXTURE_2D, mesh.boneTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, bones.length / 16, gl.RGBA, gl.FLOAT, bones);
  }

  /**
   * The model's blend modes. Colour is accumulated premultiplied by coverage, so the canvas
   * holds a correct transparent image. Additive modes count their brightness as coverage
   * (set in the shader); modes that multiply leave coverage alone.
   */
  private applyBlend(mode: number): void {
    const { gl } = this;
    if (mode <= 1) {
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    switch (mode) {
      case 2: gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break; // alpha
      case 3: // add, ignoring alpha
      case 4: gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break; // add (scaled in the shader)
      case 5: gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); break; // modulate
      case 6: gl.blendFuncSeparate(gl.DST_COLOR, gl.SRC_COLOR, gl.ZERO, gl.ONE); break; // modulate 2x
      default: gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break; // blend-add
    }
  }

  private cameraMatrices(camera: Camera, aspect: number) {
    const { min, max } = this.framing ?? this.bounds;
    const center: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    // The character faces +X; yaw 0 puts the camera in front of it. Z is up.
    const toCamera = [
      Math.cos(camera.pitch) * Math.cos(camera.yaw),
      Math.cos(camera.pitch) * Math.sin(camera.yaw),
      Math.sin(camera.pitch),
    ] as const;
    // The camera's right and up directions in the world.
    const right = [-Math.sin(camera.yaw), Math.cos(camera.yaw), 0] as const;
    const up = [
      -Math.sin(camera.pitch) * Math.cos(camera.yaw),
      -Math.sin(camera.pitch) * Math.sin(camera.yaw),
      Math.cos(camera.pitch),
    ] as const;

    // The nearest the camera can be with every corner of the box inside the view. A corner
    // that sticks out toward the camera (a sword held forward) needs more room than one beside it.
    const tanY = Math.tan(camera.fov / 2);
    const tanX = tanY * aspect;
    let distance = 0;
    let nearest = -Infinity;
    let farthest = Infinity;
    for (let corner = 0; corner < 8; corner++) {
      const dx = (corner & 1 ? max[0] : min[0]) - center[0];
      const dy = (corner & 2 ? max[1] : min[1]) - center[1];
      const dz = (corner & 4 ? max[2] : min[2]) - center[2];
      const across = dx * right[0] + dy * right[1] + dz * right[2];
      const along = dx * up[0] + dy * up[1] + dz * up[2];
      const toward = dx * toCamera[0] + dy * toCamera[1] + dz * toCamera[2];
      distance = Math.max(distance, toward + Math.abs(across) / tanX, toward + Math.abs(along) / tanY);
      nearest = Math.max(nearest, toward);
      farthest = Math.min(farthest, toward);
    }
    distance = distance * 1.06 * camera.zoom;
    // Panning slides the camera and what it looks at together, across the frame.
    const reach = distance * tanY;
    const target: [number, number, number] = [0, 1, 2].map(
      (c) => center[c]! - (right[c]! * camera.panX + up[c]! * camera.panY) * reach,
    ) as [number, number, number];
    const eye: [number, number, number] = [
      target[0] + distance * toCamera[0],
      target[1] + distance * toCamera[1],
      target[2] + distance * toCamera[2],
    ];
    const view = lookAt(eye, target, up);
    const near = Math.max(0.02, (distance - nearest) * 0.5);
    // With a world around, the view reaches as far as the world is drawn.
    const far = Math.max((distance - farthest) * 1.5 + 1, this.place ? distance + this.place.reach : 0);
    return { view, projection: perspective(camera.fov, aspect, near, far), axes: { toCamera, right, up, tan: [tanX, tanY] as const }, near, far, distance };
  }
}

function link(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader program failed to link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

/** Solid batches first, then blended ones in the model's order of priority and layer. */
function inOrder(draws: PreparedDraw[]): PreparedDraw[] {
  const blended = (d: PreparedDraw) => (d.draw.blendMode > 1 ? 1 : 0);
  return draws
    .map((d, i) => ({ d, i }))
    .sort((a, b) => blended(a.d) - blended(b.d) || a.d.draw.priority - b.d.draw.priority || a.d.draw.layer - b.d.draw.layer || a.i - b.i)
    .map(({ d }) => d);
}
