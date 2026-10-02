import type { CharacterScene, SceneDraw } from '../character/scene';
import { VERTEX_SIZE } from '../formats/m2';
import { lookAt, perspective, transformPoint } from '../math/mat4';
import { combiners } from './shader-table';
import { FRAGMENT_SOURCE, VERTEX_SOURCE } from './shaders';

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
}

export const DEFAULT_CAMERA: Camera = { yaw: 0, pitch: 0, fov: (30 * Math.PI) / 180, zoom: 1 };

interface PreparedDraw {
  draw: SceneDraw;
  vertexShader: number;
  pixelShader: number;
}

const UNIFORMS = [
  'u_view', 'u_projection', 'u_bones', 'u_vertex_shader', 'u_pixel_shader', 'u_blend_mode', 'u_unlit',
  'u_ambient', 'u_light_color', 'u_light_direction', 'u_texture1', 'u_texture2', 'u_texture3', 'u_texture4',
] as const;

/** Draws one character scene into a canvas with a transparent background. */
export class CharacterRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly boneTexture: WebGLTexture;
  private readonly white: WebGLTexture;
  private textures: WebGLTexture[] = [];
  private draws: PreparedDraw[] = [];
  private bounds: CharacterScene['bounds'] = { min: [0, 0, 0], max: [0, 0, 0] };
  /** Problems found while preparing the scene for drawing (unknown shaders and the like). */
  problems: string[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) throw new Error('This browser cannot create a WebGL2 context');
    this.gl = gl;
    this.program = link(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
    for (const name of UNIFORMS) this.uniforms[name] = gl.getUniformLocation(this.program, name);

    this.vao = gl.createVertexArray()!;
    this.vertexBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
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

    this.boneTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.boneTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  }

  setScene(scene: CharacterScene): void {
    const { gl } = this;
    this.problems = [];
    this.bounds = scene.bounds;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, scene.vertices, gl.STATIC_DRAW);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, scene.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    gl.bindTexture(gl.TEXTURE_2D, this.boneTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, scene.bones.length / 16, 0, gl.RGBA, gl.FLOAT, scene.bones);

    for (const texture of this.textures) gl.deleteTexture(texture);
    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    this.textures = scene.textures.map((image) => {
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
    });

    const prepared: PreparedDraw[] = [];
    for (const draw of scene.draws) {
      const shaders = combiners(draw.shaderId, draw.textureCount);
      if (!shaders) {
        this.problems.push(`Geoset ${draw.sectionId} uses a shader this app does not know (${draw.shaderId})`);
        continue;
      }
      prepared.push({ draw, vertexShader: shaders.vertex, pixelShader: shaders.pixel });
    }
    // Solid batches first, then blended ones in the model's order of priority and layer.
    const blended = (d: PreparedDraw) => (d.draw.blendMode > 1 ? 1 : 0);
    this.draws = prepared
      .map((d, i) => ({ d, i }))
      .sort((a, b) => blended(a.d) - blended(b.d) || a.d.draw.priority - b.d.draw.priority || a.d.draw.layer - b.d.draw.layer || a.i - b.i)
      .map(({ d }) => d);
  }

  /** Draw the scene. The canvas's pixel size is used as it is. */
  render(camera: Camera = DEFAULT_CAMERA): void {
    const { gl, canvas, uniforms } = this;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.draws.length === 0) return;

    const { view, projection } = this.cameraMatrices(camera, canvas.width / canvas.height);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(uniforms.u_view, false, view);
    gl.uniformMatrix4fv(uniforms.u_projection, false, projection);

    // A light from in front of and above the character, slightly to one side, fixed to the camera.
    gl.uniform3f(uniforms.u_ambient, 0.55, 0.55, 0.55);
    gl.uniform3f(uniforms.u_light_color, 0.6, 0.6, 0.6);
    gl.uniform3f(uniforms.u_light_direction, 0.35, -0.5, -0.8);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.boneTexture);
    gl.uniform1i(uniforms.u_bones, 4);
    gl.uniform1i(uniforms.u_texture1, 0);
    gl.uniform1i(uniforms.u_texture2, 1);
    gl.uniform1i(uniforms.u_texture3, 2);
    gl.uniform1i(uniforms.u_texture4, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.bindVertexArray(this.vao);

    for (const { draw, vertexShader, pixelShader } of this.draws) {
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
        gl.bindTexture(gl.TEXTURE_2D, this.textures[draw.textures[stage] ?? -1] ?? this.white);
      }
      gl.drawElements(gl.TRIANGLES, draw.indexCount, gl.UNSIGNED_SHORT, draw.indexStart * 2);
    }

    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /**
   * The model's blend modes. Colour is accumulated premultiplied by coverage, so the canvas
   * holds a correct transparent image. Modes that only add or multiply light leave coverage alone.
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
      case 3: gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE); break; // add, ignoring alpha
      case 4: gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE); break; // add
      case 5: gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE); break; // modulate
      case 6: gl.blendFuncSeparate(gl.DST_COLOR, gl.SRC_COLOR, gl.ZERO, gl.ONE); break; // modulate 2x
      default: gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); break; // blend-add
    }
  }

  private cameraMatrices(camera: Camera, aspect: number) {
    const { min, max } = this.bounds;
    const center: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    // Distance at which the character's height and width both fit, with a margin.
    const halfHeight = (max[2] - min[2]) / 2;
    const halfWidth = Math.max(max[1] - min[1], max[0] - min[0]) / 2;
    const tan = Math.tan(camera.fov / 2);
    const distance = (Math.max(halfHeight / tan, halfWidth / (tan * aspect)) * 1.08 + halfWidth) * camera.zoom;
    // The character faces +X; yaw 0 puts the camera in front of it. Z is up.
    const eye: [number, number, number] = [
      center[0] + distance * Math.cos(camera.pitch) * Math.cos(camera.yaw),
      center[1] + distance * Math.cos(camera.pitch) * Math.sin(camera.yaw),
      center[2] + distance * Math.sin(camera.pitch),
    ];
    const view = lookAt(eye, center, [0, 0, 1]);
    const depth = -transformPoint(view, center)[2];
    return { view, projection: perspective(camera.fov, aspect, Math.max(0.05, depth - radius * 1.5), depth + radius * 1.5) };
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
