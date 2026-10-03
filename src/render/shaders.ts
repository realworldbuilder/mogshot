/*
 * GLSL for drawing M2 batches. The vertex and pixel combiner cases are the game's fixed set,
 * documented on wowdev.wiki (M2#Shaders); this port follows wow.export's m2 shaders
 * (MIT, Kruithne and Marlamin). Case numbers match shader-table.ts.
 */

export const VERTEX_SOURCE = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_bone_weights;
layout(location = 2) in uvec4 a_bone_indices;
layout(location = 3) in vec3 a_normal;
layout(location = 4) in vec2 a_texcoord;
layout(location = 5) in vec2 a_texcoord2;

uniform mat4 u_view;
uniform mat4 u_projection;
// Where the mesh sits: identity for the body, the attachment point for things mounted on it.
uniform mat4 u_model;
// One bone per row, four texels wide: the columns of its matrix.
uniform sampler2D u_bones;
uniform int u_vertex_shader;

out vec2 v_texcoord;
out vec2 v_texcoord2;
out vec2 v_texcoord3;
out vec3 v_normal;
out float v_edge_fade;
out float v_distance;

mat4 bone(uint index) {
  int row = int(index);
  return mat4(
    texelFetch(u_bones, ivec2(0, row), 0),
    texelFetch(u_bones, ivec2(1, row), 0),
    texelFetch(u_bones, ivec2(2, row), 0),
    texelFetch(u_bones, ivec2(3, row), 0));
}

vec2 env_coord(vec3 position_view, vec3 normal_view) {
  vec3 r = reflect(normalize(position_view), normalize(normal_view));
  float m = 2.0 * sqrt(r.x * r.x + r.y * r.y + (r.z + 1.0) * (r.z + 1.0));
  return vec2(r.x / m + 0.5, r.y / m + 0.5);
}

void main() {
  mat4 skin = mat4(1.0);
  float total = dot(a_bone_weights, vec4(1.0));
  if (total > 0.0) {
    skin = a_bone_weights.x * bone(a_bone_indices.x)
         + a_bone_weights.y * bone(a_bone_indices.y)
         + a_bone_weights.z * bone(a_bone_indices.z)
         + a_bone_weights.w * bone(a_bone_indices.w);
    skin /= total;
  }

  skin = u_model * skin;
  vec4 position_view = u_view * skin * vec4(a_position, 1.0);
  gl_Position = u_projection * position_view;
  v_distance = length(position_view.xyz);
  vec3 normal_view = normalize(mat3(u_view) * mat3(skin) * a_normal);
  v_normal = normal_view;

  vec2 env = env_coord(position_view.xyz, normal_view);
  float n_dot_v = abs(dot(normal_view, normalize(-position_view.xyz)));
  float edge = clamp(n_dot_v * n_dot_v, 0.0, 1.0);

  v_texcoord = a_texcoord;
  v_texcoord2 = vec2(0.0);
  v_texcoord3 = vec2(0.0);
  v_edge_fade = 1.0;

  switch (u_vertex_shader) {
    case 0: break;                                                             // Diffuse_T1
    case 1: v_texcoord = env; break;                                           // Diffuse_Env
    case 2: v_texcoord2 = a_texcoord2; break;                                  // Diffuse_T1_T2
    case 3: v_texcoord2 = env; break;                                          // Diffuse_T1_Env
    case 4: v_texcoord = env; v_texcoord2 = a_texcoord; break;                 // Diffuse_Env_T1
    case 5: v_texcoord = env; v_texcoord2 = env; break;                        // Diffuse_Env_Env
    case 6: v_texcoord2 = env; v_texcoord3 = a_texcoord; break;                // Diffuse_T1_Env_T1
    case 7: v_texcoord2 = a_texcoord; break;                                   // Diffuse_T1_T1
    case 8: v_texcoord2 = a_texcoord; v_texcoord3 = a_texcoord; break;         // Diffuse_T1_T1_T1
    case 9: v_edge_fade = edge; break;                                         // Diffuse_EdgeFade_T1
    case 10: v_texcoord = a_texcoord2; break;                                  // Diffuse_T2
    case 11: v_texcoord2 = env; v_texcoord3 = a_texcoord2; break;              // Diffuse_T1_Env_T2
    case 12: v_edge_fade = edge; v_texcoord2 = a_texcoord2; break;             // Diffuse_EdgeFade_T1_T2
    case 13: v_edge_fade = edge; v_texcoord = env; break;                      // Diffuse_EdgeFade_Env
    case 14: v_texcoord2 = a_texcoord2; v_texcoord3 = a_texcoord; break;       // Diffuse_T1_T2_T1
    case 15: v_texcoord2 = a_texcoord2; v_texcoord3 = a_texcoord2; break;      // Diffuse_T1_T2_T3
    case 16: v_texcoord = a_texcoord2; v_texcoord3 = a_texcoord2; break;       // Color_T1_T2_T3
    default: break;                                                            // BW_Diffuse_*
  }
}
`;

export const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_texcoord;
in vec2 v_texcoord2;
in vec2 v_texcoord3;
in vec3 v_normal;
in float v_edge_fade;
in float v_distance;

uniform sampler2D u_texture1;
uniform sampler2D u_texture2;
uniform sampler2D u_texture3;
uniform sampler2D u_texture4;

uniform int u_pixel_shader;
uniform int u_blend_mode;
uniform bool u_unlit;
uniform vec3 u_ambient;
uniform vec3 u_light_color;
// Direction the light travels, in view space.
uniform vec3 u_light_direction;
// For props of a place: the haze they fade into and how far the place reaches; 0 for no haze.
uniform vec3 u_haze;
uniform float u_reach;

out vec4 frag_color;

void main() {
  vec2 uv1 = v_texcoord;
  vec2 uv2 = v_texcoord2;
  vec2 uv3 = v_texcoord3;
  if (u_pixel_shader == 26 || u_pixel_shader == 27 || u_pixel_shader == 28) {
    uv2 = uv1;
    uv3 = uv1;
  }

  vec4 tex1 = texture(u_texture1, uv1);
  vec4 tex2 = texture(u_texture2, uv2);
  vec4 tex3 = texture(u_texture3, uv3);
  vec4 tex4 = texture(u_texture4, v_texcoord2);

  vec3 diffuse = vec3(0.0);
  vec3 specular = vec3(0.0);
  // Alpha from the textures, for combiners that have one.
  float alpha = 1.0;
  bool has_alpha = false;

  switch (u_pixel_shader) {
    case 0: diffuse = tex1.rgb; break;                                              // Opaque
    case 1: diffuse = tex1.rgb; alpha = tex1.a; has_alpha = true; break;            // Mod
    case 2: diffuse = tex1.rgb * tex2.rgb; alpha = tex2.a; has_alpha = true; break; // Opaque_Mod
    case 3: diffuse = tex1.rgb * tex2.rgb * 2.0; alpha = tex2.a * 2.0; has_alpha = true; break; // Opaque_Mod2x
    case 4: diffuse = tex1.rgb * tex2.rgb * 2.0; break;                             // Opaque_Mod2xNA
    case 5: diffuse = tex1.rgb * tex2.rgb; break;                                   // Opaque_Opaque
    case 6: diffuse = tex1.rgb * tex2.rgb; alpha = tex1.a * tex2.a; has_alpha = true; break; // Mod_Mod
    case 7: diffuse = tex1.rgb * tex2.rgb * 2.0; alpha = tex1.a * tex2.a * 2.0; has_alpha = true; break; // Mod_Mod2x
    case 8: diffuse = tex1.rgb; alpha = tex1.a + tex2.a; has_alpha = true; specular = tex2.rgb; break; // Mod_Add
    case 9: diffuse = tex1.rgb * tex2.rgb * 2.0; alpha = tex1.a; has_alpha = true; break; // Mod_Mod2xNA
    case 10: diffuse = tex1.rgb; alpha = tex1.a; has_alpha = true; specular = tex2.rgb; break; // Mod_AddNA
    case 11: diffuse = tex1.rgb * tex2.rgb; alpha = tex1.a; has_alpha = true; break; // Mod_Opaque
    case 12: diffuse = mix(tex1.rgb * tex2.rgb * 2.0, tex1.rgb, vec3(tex1.a)); break; // Opaque_Mod2xNA_Alpha
    case 13: diffuse = tex1.rgb; specular = tex2.rgb * tex2.a; break;               // Opaque_AddAlpha
    case 14: diffuse = tex1.rgb; specular = tex2.rgb * tex2.a * (1.0 - tex1.a); break; // Opaque_AddAlpha_Alpha
    case 15: diffuse = mix(tex1.rgb * tex2.rgb * 2.0, tex1.rgb, vec3(tex1.a)); specular = tex3.rgb * tex3.a; break; // Opaque_Mod2xNA_Alpha_Add
    case 16: diffuse = tex1.rgb; alpha = tex1.a; has_alpha = true; specular = tex2.rgb * tex2.a; break; // Mod_AddAlpha
    case 17: // Mod_AddAlpha_Alpha
      diffuse = tex1.rgb;
      alpha = tex1.a + tex2.a * (0.3 * tex2.r + 0.59 * tex2.g + 0.11 * tex2.b);
      has_alpha = true;
      specular = tex2.rgb * tex2.a * (1.0 - tex1.a);
      break;
    case 18: diffuse = mix(mix(tex1.rgb, tex2.rgb, vec3(tex2.a)), tex1.rgb, vec3(tex1.a)); break; // Opaque_Alpha_Alpha
    case 19: diffuse = mix(tex1.rgb * tex2.rgb * 2.0, tex3.rgb, vec3(tex3.a)); break; // Opaque_Mod2xNA_Alpha_3s
    case 20: diffuse = tex1.rgb; specular = tex2.rgb * tex2.a; break;               // Opaque_AddAlpha_Wgt
    case 21: diffuse = tex1.rgb; alpha = tex1.a + tex2.a; has_alpha = true; specular = tex2.rgb * (1.0 - tex1.a); break; // Mod_Add_Alpha
    case 22: diffuse = mix(tex1.rgb * tex2.rgb, tex1.rgb, vec3(tex1.a)); break;     // Opaque_ModNA_Alpha
    case 23: diffuse = tex1.rgb; alpha = tex1.a; has_alpha = true; specular = tex2.rgb * tex2.a; break; // Mod_AddAlpha_Wgt
    case 24: diffuse = mix(tex1.rgb, tex2.rgb, vec3(tex2.a)); specular = tex1.rgb * tex1.a; break; // Opaque_Mod_Add_Wgt
    case 25: { // Opaque_Mod2xNA_Alpha_UnshAlpha
      float glow = clamp(tex3.a, 0.0, 1.0);
      diffuse = mix(tex1.rgb * tex2.rgb * 2.0, tex1.rgb, vec3(tex1.a)) * (1.0 - glow);
      specular = tex3.rgb * glow;
      break;
    }
    case 26: { // Mod_Dual_Crossfade (texture weights 1: the last texture wins)
      diffuse = tex3.rgb; alpha = tex3.a; has_alpha = true;
      break;
    }
    case 27: diffuse = mix(mix(tex1.rgb * tex2.rgb * 2.0, tex3.rgb, vec3(tex3.a)), tex1.rgb, vec3(tex1.a)); break; // Opaque_Mod2xNA_Alpha_Alpha
    case 28: diffuse = tex3.rgb; alpha = tex3.a * tex4.a; has_alpha = true; break;  // Mod_Masked_Dual_Crossfade
    case 29: diffuse = mix(tex1.rgb, tex2.rgb, vec3(tex2.a)); break;                // Opaque_Alpha
    case 30: // Guild
      diffuse = mix(tex1.rgb * mix(vec3(1.0), tex2.rgb, vec3(tex2.a)), tex3.rgb, vec3(tex3.a));
      alpha = tex1.a; has_alpha = true;
      break;
    case 31: diffuse = tex1.rgb * mix(vec3(1.0), tex2.rgb, vec3(tex2.a)); alpha = tex1.a; has_alpha = true; break; // Guild_NoBorder
    case 32: diffuse = mix(tex1.rgb * mix(vec3(1.0), tex2.rgb, vec3(tex2.a)), tex3.rgb, vec3(tex3.a)); break; // Guild_Opaque
    case 33: diffuse = tex1.rgb; alpha = tex1.a; has_alpha = true; break;           // Mod_Depth
    case 34: alpha = tex1.a; has_alpha = true; break;                               // Illum
    case 35: { // Mod_Mod_Mod_Const
      vec4 combined = tex1 * tex2 * tex3;
      diffuse = combined.rgb; alpha = combined.a; has_alpha = true;
      break;
    }
    case 36: diffuse = tex1.rgb * tex2.rgb; alpha = tex1.a * tex2.a; has_alpha = true; break; // Mod_Mod_Depth
    default: diffuse = tex1.rgb; break;
  }

  if (u_blend_mode == 1 && has_alpha && alpha < 0.501960814) discard; // alpha key: cut out below one half

  vec3 color = diffuse;
  if (!u_unlit) {
    float n_dot_l = max(dot(normalize(v_normal), -normalize(u_light_direction)), 0.0);
    color *= clamp(u_ambient + u_light_color * n_dot_l, 0.0, 1.0);
  }
  color += specular;
  float clear = u_reach > 0.0 ? 1.0 - smoothstep(u_reach * 0.25, u_reach, v_distance) : 1.0;
  // Light added to the picture fades out in the haze; everything else fades into it.
  if (u_blend_mode == 3 || u_blend_mode == 4) color *= clear;
  else color = mix(u_haze, color, clear);

  // What goes to the blender. The framebuffer holds colour premultiplied by coverage, so
  // that the finished picture has correct transparency (see applyBlend in renderer.ts).
  float coverage = 1.0;
  if (u_blend_mode == 3 || u_blend_mode == 4) {
    // Additive light (glows). It has no real coverage; over a transparent background its
    // coverage is taken to be its brightness, which reproduces it exactly over black.
    if (u_blend_mode == 4) color *= alpha * v_edge_fade;
    coverage = clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0);
  } else if (u_blend_mode >= 2) {
    coverage = alpha * v_edge_fade;
  }
  frag_color = vec4(color, coverage);
}
`;

/** Averages blocks of the supersampled picture down to the output size. */
export const DOWNSAMPLE_VERTEX_SOURCE = `#version 300 es
void main() {
  // One triangle that covers the whole target.
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const DOWNSAMPLE_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform int u_factor;
out vec4 frag_color;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * u_factor;
  vec4 sum = vec4(0.0);
  for (int y = 0; y < u_factor; y++) {
    for (int x = 0; x < u_factor; x++) sum += texelFetch(u_source, base + ivec2(x, y), 0);
  }
  frag_color = sum / float(u_factor * u_factor);
}
`;

/** A backdrop picture filling the frame behind the character. `u_frame` is the part of the full view being drawn (x0, y0, x1, y1). */
export const BACKDROP_VERTEX_SOURCE = `#version 300 es
uniform vec4 u_frame;
out vec2 v_uv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
  // The frame's -1..1 view coordinates for this corner, then the picture's 0..1 with its first row at the top.
  vec2 view = u_frame.xy + corner * (u_frame.zw - u_frame.xy);
  v_uv = vec2((view.x + 1.0) * 0.5, 1.0 - (view.y + 1.0) * 0.5);
}
`;

export const BACKDROP_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_backdrop;
in vec2 v_uv;
out vec4 frag_color;
void main() {
  frag_color = vec4(texture(u_backdrop, v_uv).rgb, 1.0);
}
`;

/*
 * The world around the character: buildings as stored, lit by a fixed sun and sky outdoors
 * and by their baked light indoors, fading into the haze with distance.
 */
export const PLACE_VERTEX_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_texcoord;
layout(location = 3) in vec4 a_baked;

uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat4 u_model;

out vec2 v_texcoord;
out vec3 v_normal;
out vec4 v_baked;
out float v_distance;

void main() {
  vec4 position_view = u_view * u_model * vec4(a_position, 1.0);
  gl_Position = u_projection * position_view;
  v_texcoord = a_texcoord;
  v_normal = mat3(u_model) * a_normal;
  v_baked = a_baked;
  v_distance = length(position_view.xyz);
}
`;

export const PLACE_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 v_texcoord;
in vec3 v_normal;
in vec4 v_baked;
in float v_distance;

uniform sampler2D u_texture;
uniform int u_blend_mode;
uniform bool u_outdoors;
uniform bool u_baked;
uniform bool u_water;
uniform bool u_shadow;
uniform bool u_unlit;
// The sun's direction in the character's space, and the colours of sun, sky and haze.
uniform vec3 u_sun_direction;
uniform vec3 u_sun_color;
uniform vec3 u_ambient;
uniform vec3 u_haze;
uniform float u_reach;

out vec4 out_color;

void main() {
  if (u_shadow) {
    // The soft shadow under the character: darkest under the feet, gone at its edge.
    float fade = 1.0 - smoothstep(0.15, 1.0, length(v_texcoord * 2.0 - 1.0));
    out_color = vec4(0.0, 0.0, 0.0, 0.5 * fade);
    return;
  }
  vec4 texel = texture(u_texture, v_texcoord);
  if (u_blend_mode == 1 && texel.a < 0.5) discard;
  vec3 normal = normalize(gl_FrontFacing ? v_normal : -v_normal);
  // Indoors: an even light, plus whatever light is baked into the walls.
  vec3 light = vec3(0.6) + (u_baked ? v_baked.rgb * 1.5 : vec3(0.0));
  if (u_outdoors) light = u_ambient + u_sun_color * max(dot(normal, u_sun_direction), 0.0) + v_baked.rgb;
  if (u_unlit) light = vec3(1.0);
  vec3 color = texel.rgb * light;
  if (u_water) {
    // Still water: its own colour under the sky's light, clearer looked straight down on.
    color = vec3(0.13, 0.27, 0.33) * (u_ambient + u_sun_color);
    texel.a = 0.82;
  }
  // Haze: none near the character, complete at the edge of what is drawn.
  float haze = smoothstep(u_reach * 0.25, u_reach, v_distance);
  color = mix(color, u_haze, haze);
  float alpha = u_blend_mode > 1 ? texel.a : 1.0;
  out_color = vec4(color * alpha, alpha);
}
`;

/** The ground: up to four textures spread by a blend picture, tinted and lit like the outdoors. Uses the place's vertex shader. */
export const TERRAIN_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 v_texcoord;
in vec3 v_normal;
in vec4 v_baked;
in float v_distance;

uniform sampler2D u_layer0;
uniform sampler2D u_layer1;
uniform sampler2D u_layer2;
uniform sampler2D u_layer3;
uniform sampler2D u_blend;
uniform int u_layers;
// The chunk's column and row in its tile, 0 to 15.
uniform vec2 u_chunk;
uniform vec3 u_sun_direction;
uniform vec3 u_sun_color;
uniform vec3 u_ambient;
uniform vec3 u_haze;
uniform float u_reach;

out vec4 out_color;

void main() {
  // Stay half a texel inside the chunk's own part of the blend picture.
  vec2 cell = clamp(v_texcoord, 0.5 / 64.0, 1.0 - 0.5 / 64.0);
  vec3 cover = texture(u_blend, (u_chunk + cell) / 16.0).rgb;
  vec2 uv = v_texcoord * 8.0;
  vec3 color = u_layers > 0 ? texture(u_layer0, uv).rgb : vec3(0.35, 0.4, 0.3);
  if (u_layers > 1) color = mix(color, texture(u_layer1, uv).rgb, cover.r);
  if (u_layers > 2) color = mix(color, texture(u_layer2, uv).rgb, cover.g);
  if (u_layers > 3) color = mix(color, texture(u_layer3, uv).rgb, cover.b);
  vec3 light = u_ambient + u_sun_color * max(dot(normalize(v_normal), u_sun_direction), 0.0);
  color *= light * v_baked.rgb * 2.0;
  color = mix(color, u_haze, smoothstep(u_reach * 0.25, u_reach, v_distance));
  out_color = vec4(color, 1.0);
}
`;

/** The sky of a place: haze at the horizon, blue overhead. `u_frame` as for the backdrop. */
export const SKY_VERTEX_SOURCE = `#version 300 es
uniform vec4 u_frame;
out vec2 v_view;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
  v_view = u_frame.xy + corner * (u_frame.zw - u_frame.xy);
}
`;

export const SKY_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_view;
// The camera's directions in the world, and the tangents of half its field of view.
uniform vec3 u_forward;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec2 u_tan;
uniform vec3 u_haze;
uniform vec3 u_zenith;
out vec4 frag_color;
void main() {
  vec3 ray = normalize(u_forward + u_right * v_view.x * u_tan.x + u_up * v_view.y * u_tan.y);
  float rise = clamp(ray.z, 0.0, 1.0);
  frag_color = vec4(mix(u_haze, u_zenith, pow(rise, 0.6)), 1.0);
}
`;

/**
 * Depth of field for a place: each pixel is blurred by how far it is from the distance the
 * character stands at, so the character is sharp and the world behind softens. One pass,
 * gathering from a disc; a sample only counts if its own blur reaches the pixel.
 */
export const FOCUS_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_color;
uniform sampler2D u_depth;
uniform vec2 u_size;
uniform float u_near;
uniform float u_far;
uniform float u_focus;
// The largest blur, in pixels.
uniform float u_blur;
out vec4 frag_color;

float distance_at(vec2 uv) {
  float depth = texture(u_depth, uv).r * 2.0 - 1.0;
  return 2.0 * u_near * u_far / (u_far + u_near - depth * (u_far - u_near));
}

float blur_at(float distance) {
  // Nothing within a stride of the character, then growing toward the horizon.
  float behind = max(distance - u_focus * 1.15, 0.0) / distance;
  float before = max(u_focus * 0.8 - distance, 0.0) / u_focus;
  return u_blur * clamp(max(behind * 1.6, before * 2.0), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec4 sum = texture(u_color, uv);
  if (u_blur <= 0.0) {
    frag_color = sum;
    return;
  }
  float here = distance_at(uv);
  float blur = blur_at(here);
  float total = 1.0;
  const int TAPS = 56;
  for (int i = 1; i <= TAPS; i++) {
    float reach = u_blur * sqrt(float(i) / float(TAPS));
    float turn = float(i) * 2.39996323;
    vec2 at = uv + vec2(cos(turn), sin(turn)) * reach / u_size;
    float there = distance_at(at);
    float spread = blur_at(there);
    // What is behind this pixel cannot smear over it further than this pixel is itself blurred.
    if (there > here) spread = min(spread, blur * 2.0);
    float weight = smoothstep(reach - 1.0, reach + 1.0, spread);
    sum += texture(u_color, at) * weight;
    total += weight;
  }
  frag_color = sum / total;
}
`;
