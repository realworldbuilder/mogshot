import { describe, expect, it } from 'vitest';
import { SpellVisuals, type SpellVisualTables } from '../../src/character/spell-visuals';

// Lightning Bolt as the classic files have it: a missile, a model in each spell hand at the
// precast and at the cast, the same impact from two kits, and an NPC copy with no visual.
const TABLES: SpellVisualTables = {
  names: [{ ID: 403, Name_lang: 'Lightning Bolt' }, { ID: 9532, Name_lang: 'Lightning Bolt' }, { ID: 17, Name_lang: 'Power Word: Shield' }],
  xSpellVisual: [
    { ID: 1, SpellID: 403, SpellVisualID: 173, DifficultyID: 0 },
    { ID: 2, SpellID: 17, SpellVisualID: 784, DifficultyID: 0 },
  ],
  visual: [{ ID: 173, SpellVisualMissileSetID: 50 }, { ID: 784, SpellVisualMissileSetID: 0 }],
  missile: [{ ID: 9, SpellVisualMissileSetID: 50, SpellVisualEffectNameID: 1 }],
  event: [
    { ID: 1, SpellVisualID: 173, SpellVisualKitID: 124, StartEvent: 1 },
    { ID: 2, SpellVisualID: 173, SpellVisualKitID: 72, StartEvent: 3 },
    { ID: 3, SpellVisualID: 173, SpellVisualKitID: 283, StartEvent: 6 },
    { ID: 4, SpellVisualID: 173, SpellVisualKitID: 261808, StartEvent: 6 },
    { ID: 5, SpellVisualID: 784, SpellVisualKitID: 847, StartEvent: 7 },
    { ID: 6, SpellVisualID: 784, SpellVisualKitID: 848, StartEvent: 8 },
  ],
  kitEffect: [
    { ID: 1, ParentSpellVisualKitID: 124, EffectType: 2, Effect: 10 },
    { ID: 2, ParentSpellVisualKitID: 124, EffectType: 2, Effect: 11 },
    { ID: 3, ParentSpellVisualKitID: 124, EffectType: 1, Effect: 99 },
    { ID: 4, ParentSpellVisualKitID: 72, EffectType: 2, Effect: 12 },
    { ID: 5, ParentSpellVisualKitID: 283, EffectType: 2, Effect: 13 },
    { ID: 6, ParentSpellVisualKitID: 261808, EffectType: 2, Effect: 13 },
    { ID: 7, ParentSpellVisualKitID: 847, EffectType: 2, Effect: 14 },
    { ID: 8, ParentSpellVisualKitID: 848, EffectType: 2, Effect: 14 },
  ],
  modelAttach: [
    { ID: 10, SpellVisualEffectNameID: 2, AttachmentID: 21, Scale: 1 },
    { ID: 11, SpellVisualEffectNameID: 2, AttachmentID: 22, Scale: 1 },
    { ID: 12, SpellVisualEffectNameID: 3, AttachmentID: 21, Scale: 0 },
    { ID: 13, SpellVisualEffectNameID: 4, AttachmentID: 34, Scale: 2 },
    { ID: 14, SpellVisualEffectNameID: 5, AttachmentID: 19, Scale: 1 },
  ],
  effectName: [
    { ID: 1, ModelFileDataID: 166497, Scale: 1 },
    { ID: 2, ModelFileDataID: 166492, Scale: 1 },
    { ID: 3, ModelFileDataID: 166488, Scale: 0.5 },
    { ID: 4, ModelFileDataID: 166496, Scale: 1 },
    { ID: 5, ModelFileDataID: 166342, Scale: 1 },
  ],
};

describe('spell visuals', () => {
  const visuals = new SpellVisuals(TABLES);

  it('reads a spell as its missile and the models of each moment of the cast', () => {
    const [bolt] = visuals.find([{ name: 'lightning bolt' }]);
    expect(bolt).toMatchObject({ name: 'lightning bolt', spellId: 403, missiles: [{ fileId: 166497, scale: 1 }] });
    expect(bolt!.models.map((m) => `${m.moment}:${m.fileId}@${m.attachment}x${m.scale}`)).toEqual([
      'precast:166492@21x1', 'precast:166492@22x1', 'cast:166488@21x0.5', 'impact:166496@34x2',
    ]);
  });

  it('keeps an aura model and leaves out the moments it does not draw', () => {
    const [shield] = visuals.find([{ name: 'Power Word: Shield' }]);
    expect(shield!.missiles).toEqual([]);
    expect(shield!.models).toEqual([{ fileId: 166342, scale: 1, attachment: 19, moment: 'aura' }]);
  });

  it('tries the ids given before the name, and has nothing for a spell with no visual', () => {
    const [byId, none] = visuals.find([{ name: 'Something', ids: [9532, 17] }, { name: 'Moonfire' }]);
    expect(byId!.spellId).toBe(17);
    expect(none).toEqual({ name: 'Moonfire', spellId: 0, missiles: [], models: [] });
  });
});
