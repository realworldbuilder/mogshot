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
// One bone per row, four texels wide: the columns of its matrix.
uniform sampler2D u_bones;
uniform int u_vertex_shader;

out vec2 v_texcoord;
out vec2 v_texcoord2;
out vec2 v_texcoord3;
out vec3 v_normal;
out float v_edge_fade;

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

  vec4 position_view = u_view * skin * vec4(a_position, 1.0);
  gl_Position = u_projection * position_view;
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

  // Blend modes 0 (opaque) and 1 (alpha key) draw solid; alpha key cuts out below one half.
  float opacity = v_edge_fade;
  if (u_blend_mode == 1) {
    if (has_alpha && alpha < 0.501960814) discard;
  } else if (u_blend_mode != 0) {
    opacity *= alpha;
  }

  vec3 color = diffuse;
  if (!u_unlit) {
    float n_dot_l = max(dot(normalize(v_normal), -normalize(u_light_direction)), 0.0);
    color *= clamp(u_ambient + u_light_color * n_dot_l, 0.0, 1.0);
  }
  frag_color = vec4(color + specular, opacity);
}
`;
