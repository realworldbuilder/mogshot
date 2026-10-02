import { describe, expect, it } from 'vitest';
import { visibleSections } from '../../src/character/scene';
import type { Skin } from '../../src/formats/skin';

const skinWith = (ids: number[]): Skin => ({
  vertexLookup: new Uint16Array(0),
  indices: new Uint16Array(0),
  batches: [],
  sections: ids.map((id) => ({ id, vertexStart: 0, vertexCount: 0, indexStart: 0, indexCount: 0 })),
});
const shown = (ids: number[], toggles: { id: number; visible: boolean }[]) => {
  const visible = visibleSections(skinWith(ids), toggles);
  return ids.filter((_, i) => visible[i]);
};

describe('visibleSections', () => {
  const ids = [0, 1, 2, 3, 102, 106, 401, 402, 501, 1701, 1702, 3201, 3202, 3203, 3301, 3401, 3501];
  const base = [0, 1, 401, 501, 3201, 3202, 3203, 3301, 3401];

  it('shows the body, variant 1 of each group and the whole face by default', () => {
    expect(shown(ids, [])).toEqual(base);
  });

  it('shows one variant per group when a choice selects it', () => {
    // A hair option whose choices name styles 2 and 3, with style 2 chosen.
    const hair = [{ id: 3, visible: false }, { id: 2, visible: true }];
    expect(shown(ids, hair)).toEqual([0, 2, 401, 501, 3201, 3202, 3203, 3301, 3401]);
    expect(shown(ids, [{ id: 402, visible: true }])).toEqual([0, 1, 402, 501, 3201, 3202, 3203, 3301, 3401]);
  });

  it('hides a group when a choice names its variant 0', () => {
    // "Bald": no hair, but section 0 is the body and stays.
    expect(shown(ids, [{ id: 2, visible: false }, { id: 0, visible: true }])).toEqual(base.filter((id) => id !== 1));
    // Glowing eyes hide the ordinary eyeballs and show the glow.
    const glow = [{ id: 3300, visible: true }, { id: 1702, visible: true }];
    expect(shown(ids, glow)).toEqual([0, 1, 401, 501, 1702, 3201, 3202, 3203, 3401]);
  });

  it('leaves a group alone when the model lacks the variant asked for', () => {
    expect(shown(ids, [{ id: 403, visible: true }])).toEqual(base);
  });

  it('draws the common part of the face plus the chosen face shape', () => {
    // A face shape option names 3202 and 3203; 3201 belongs to every shape.
    const face = [{ id: 3203, visible: false }, { id: 3202, visible: true }];
    expect(shown(ids, face)).toEqual(base.filter((id) => id !== 3203));
  });

  it('shows hidden-by-default groups only when a choice asks', () => {
    expect(shown(ids, [])).not.toContain(1701);
    expect(shown(ids, [{ id: 1701, visible: true }])).toContain(1701);
  });
});
