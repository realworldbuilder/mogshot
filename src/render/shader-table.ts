/*
 * Which vertex and pixel combiner a batch uses, from its shader selector and texture count.
 * The table and the selection rules are the game's, as documented on wowdev.wiki (M2#Shaders)
 * and implemented in wow.export's ShaderMapper (MIT, Kruithne and Marlamin).
 *
 * The numbers are the `case` labels in the GLSL in shaders.ts.
 */

export const VERTEX_SHADERS = [
  'Diffuse_T1', 'Diffuse_Env', 'Diffuse_T1_T2', 'Diffuse_T1_Env', 'Diffuse_Env_T1', 'Diffuse_Env_Env',
  'Diffuse_T1_Env_T1', 'Diffuse_T1_T1', 'Diffuse_T1_T1_T1', 'Diffuse_EdgeFade_T1', 'Diffuse_T2',
  'Diffuse_T1_Env_T2', 'Diffuse_EdgeFade_T1_T2', 'Diffuse_EdgeFade_Env', 'Diffuse_T1_T2_T1',
  'Diffuse_T1_T2_T3', 'Color_T1_T2_T3', 'BW_Diffuse_T1', 'BW_Diffuse_T1_T2',
] as const;

export const PIXEL_SHADERS = [
  'Combiners_Opaque', 'Combiners_Mod', 'Combiners_Opaque_Mod', 'Combiners_Opaque_Mod2x',
  'Combiners_Opaque_Mod2xNA', 'Combiners_Opaque_Opaque', 'Combiners_Mod_Mod', 'Combiners_Mod_Mod2x',
  'Combiners_Mod_Add', 'Combiners_Mod_Mod2xNA', 'Combiners_Mod_AddNA', 'Combiners_Mod_Opaque',
  'Combiners_Opaque_Mod2xNA_Alpha', 'Combiners_Opaque_AddAlpha', 'Combiners_Opaque_AddAlpha_Alpha',
  'Combiners_Opaque_Mod2xNA_Alpha_Add', 'Combiners_Mod_AddAlpha', 'Combiners_Mod_AddAlpha_Alpha',
  'Combiners_Opaque_Alpha_Alpha', 'Combiners_Opaque_Mod2xNA_Alpha_3s', 'Combiners_Opaque_AddAlpha_Wgt',
  'Combiners_Mod_Add_Alpha', 'Combiners_Opaque_ModNA_Alpha', 'Combiners_Mod_AddAlpha_Wgt',
  'Combiners_Opaque_Mod_Add_Wgt', 'Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha', 'Combiners_Mod_Dual_Crossfade',
  'Combiners_Opaque_Mod2xNA_Alpha_Alpha', 'Combiners_Mod_Masked_Dual_Crossfade', 'Combiners_Opaque_Alpha',
  'Guild', 'Guild_NoBorder', 'Guild_Opaque', 'Combiners_Mod_Depth', 'Illum', 'Combiners_Mod_Mod_Mod_Const',
  'Combiners_Mod_Mod_Depth',
] as const;

type VertexShader = (typeof VERTEX_SHADERS)[number];
type PixelShader = (typeof PIXEL_SHADERS)[number];

/** Combiners for selectors with the high bit set: the low bits index this table. */
const EFFECTS: readonly (readonly [PixelShader, VertexShader])[] = [
  ['Combiners_Opaque_Mod2xNA_Alpha', 'Diffuse_T1_Env'],
  ['Combiners_Opaque_AddAlpha', 'Diffuse_T1_Env'],
  ['Combiners_Opaque_AddAlpha_Alpha', 'Diffuse_T1_Env'],
  ['Combiners_Opaque_Mod2xNA_Alpha_Add', 'Diffuse_T1_Env_T1'],
  ['Combiners_Mod_AddAlpha', 'Diffuse_T1_Env'],
  ['Combiners_Opaque_AddAlpha', 'Diffuse_T1_T1'],
  ['Combiners_Mod_AddAlpha', 'Diffuse_T1_T1'],
  ['Combiners_Mod_AddAlpha_Alpha', 'Diffuse_T1_Env'],
  ['Combiners_Opaque_Alpha_Alpha', 'Diffuse_T1_Env'],
  ['Combiners_Opaque_Mod2xNA_Alpha_3s', 'Diffuse_T1_Env_T1'],
  ['Combiners_Opaque_AddAlpha_Wgt', 'Diffuse_T1_T1'],
  ['Combiners_Mod_Add_Alpha', 'Diffuse_T1_Env'],
  ['Combiners_Opaque_ModNA_Alpha', 'Diffuse_T1_Env'],
  ['Combiners_Mod_AddAlpha_Wgt', 'Diffuse_T1_Env'],
  ['Combiners_Mod_AddAlpha_Wgt', 'Diffuse_T1_T1'],
  ['Combiners_Opaque_AddAlpha_Wgt', 'Diffuse_T1_T2'],
  ['Combiners_Opaque_Mod_Add_Wgt', 'Diffuse_T1_Env'],
  ['Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha', 'Diffuse_T1_Env_T1'],
  ['Combiners_Mod_Dual_Crossfade', 'Diffuse_T1'],
  ['Combiners_Mod_Depth', 'Diffuse_EdgeFade_T1'],
  ['Combiners_Opaque_Mod2xNA_Alpha_Alpha', 'Diffuse_T1_Env_T2'],
  ['Combiners_Mod_Mod', 'Diffuse_EdgeFade_T1_T2'],
  ['Combiners_Mod_Masked_Dual_Crossfade', 'Diffuse_T1_T2'],
  ['Combiners_Opaque_Alpha', 'Diffuse_T1_T1'],
  ['Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha', 'Diffuse_T1_Env_T2'],
  ['Combiners_Mod_Depth', 'Diffuse_EdgeFade_Env'],
  ['Guild', 'Diffuse_T1_T2_T1'],
  ['Guild_NoBorder', 'Diffuse_T1_T2'],
  ['Guild_Opaque', 'Diffuse_T1_T2_T1'],
  ['Illum', 'Diffuse_T1_T1'],
  ['Combiners_Mod_Mod_Mod_Const', 'Diffuse_T1_T2_T3'],
  ['Combiners_Mod_Mod_Mod_Const', 'Color_T1_T2_T3'],
  ['Combiners_Opaque', 'Diffuse_T1'],
  ['Combiners_Mod_Mod2x', 'Diffuse_EdgeFade_T1_T2'],
  ['Combiners_Mod', 'Diffuse_EdgeFade_T1'],
  ['Combiners_Mod_Mod_Depth', 'Diffuse_EdgeFade_T1_T2'],
];

function vertexName(shaderId: number, textureCount: number): VertexShader | undefined {
  if (shaderId & 0x8000) return EFFECTS[shaderId & 0x7fff]?.[1];
  if (textureCount === 1) {
    if (shaderId & 0x80) return 'Diffuse_Env';
    return shaderId & 0x4000 ? 'Diffuse_T2' : 'Diffuse_T1';
  }
  if (shaderId & 0x80) return shaderId & 0x8 ? 'Diffuse_Env_Env' : 'Diffuse_Env_T1';
  if (shaderId & 0x8) return 'Diffuse_T1_Env';
  return shaderId & 0x4000 ? 'Diffuse_T1_T2' : 'Diffuse_T1_T1';
}

function pixelName(shaderId: number, textureCount: number): PixelShader | undefined {
  if (shaderId & 0x8000) return EFFECTS[shaderId & 0x7fff]?.[0];
  if (textureCount === 1) return shaderId & 0x70 ? 'Combiners_Mod' : 'Combiners_Opaque';
  const second = shaderId & 7;
  if (shaderId & 0x70) {
    if (second === 3) return 'Combiners_Mod_Add';
    if (second === 4) return 'Combiners_Mod_Mod2x';
    if (second === 6) return 'Combiners_Mod_Mod2xNA';
    if (second === 7) return 'Combiners_Mod_AddNA';
    return 'Combiners_Mod_Mod';
  }
  if (second === 0) return 'Combiners_Opaque_Opaque';
  if (second === 3 || second === 7) return 'Combiners_Opaque_AddAlpha';
  if (second === 4) return 'Combiners_Opaque_Mod2x';
  if (second === 6) return 'Combiners_Opaque_Mod2xNA';
  return 'Combiners_Opaque_Mod';
}

/** Vertex and pixel combiner numbers for a batch, or undefined if its selector is unknown. */
export function combiners(shaderId: number, textureCount: number): { vertex: number; pixel: number } | undefined {
  const vertex = vertexName(shaderId, textureCount);
  const pixel = pixelName(shaderId, textureCount);
  if (!vertex || !pixel) return undefined;
  return { vertex: VERTEX_SHADERS.indexOf(vertex), pixel: PIXEL_SHADERS.indexOf(pixel) };
}
