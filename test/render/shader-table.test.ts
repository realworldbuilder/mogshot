import { describe, expect, it } from 'vitest';
import { combiners, PIXEL_SHADERS, VERTEX_SHADERS } from '../../src/render/shader-table';

const names = (shaderId: number, textureCount: number) => {
  const c = combiners(shaderId, textureCount);
  return c && [VERTEX_SHADERS[c.vertex], PIXEL_SHADERS[c.pixel]];
};

describe('combiners', () => {
  it('selects single-texture combiners from the selector bits', () => {
    expect(names(0, 1)).toEqual(['Diffuse_T1', 'Combiners_Opaque']);
    expect(names(0x10, 1)).toEqual(['Diffuse_T1', 'Combiners_Mod']);
    expect(names(0x90, 1)).toEqual(['Diffuse_Env', 'Combiners_Mod']);
    expect(names(0x4000, 1)).toEqual(['Diffuse_T2', 'Combiners_Opaque']);
  });

  it('selects two-texture combiners from the selector bits', () => {
    expect(names(0x4013, 2)).toEqual(['Diffuse_T1_T2', 'Combiners_Mod_Add']);
    expect(names(0x4014, 2)).toEqual(['Diffuse_T1_T2', 'Combiners_Mod_Mod2x']);
    expect(names(0x4011, 2)).toEqual(['Diffuse_T1_T2', 'Combiners_Mod_Mod']);
    expect(names(0x0, 2)).toEqual(['Diffuse_T1_T1', 'Combiners_Opaque_Opaque']);
    expect(names(0x9, 2)).toEqual(['Diffuse_T1_Env', 'Combiners_Opaque_Mod']);
  });

  it('looks effect selectors up in the table', () => {
    expect(names(0x8000, 2)).toEqual(['Diffuse_T1_Env', 'Combiners_Opaque_Mod2xNA_Alpha']);
    expect(names(0x801c, 6)).toEqual(['Diffuse_T1_T2_T1', 'Guild_Opaque']);
    expect(names(0x8000 + 999, 1)).toBeUndefined();
  });
});
