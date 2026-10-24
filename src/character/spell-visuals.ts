import type { CascStorage } from '../casc/storage';
import type { Database } from '../db2/database';
import type { Row } from '../db2/wdc';
import { findSequence } from '../model/pose';
import { type CharacterScene, type PackedRig, sceneReaders } from './scene';

/*
 * What a spell looks like in the game, as the models it draws: SpellXSpellVisual gives a spell
 * its visual; the visual's missile set (SpellVisualMissile) names the model that flies, and
 * its events (SpellVisualEvent) start kits (SpellVisualKit) at moments of the cast, whose
 * effects of type 2 attach a model (SpellVisualKitModelAttach) to a point of the caster or the
 * target. Every model is a SpellVisualEffectName row with its file and size.
 *
 * Much of a spell is particles and ribbons, which are not drawn here; the models' meshes
 * (a lightning ball, a column of moonlight, an ice shard) are, so a spell model with no mesh
 * is left out when it is built.
 */

/** When in a cast a model shows: while the cast bar fills, at the release, where it lands, or for as long as the aura lasts. */
export type SpellMoment = 'precast' | 'cast' | 'impact' | 'aura';

export interface SpellModelRef {
  fileId: number;
  /** The game's size for it. */
  scale: number;
  /** The attachment point it is put on (1 right hand, 19 the feet, 21/22 the spell hands, 34 the chest ...). */
  attachment: number;
  moment: SpellMoment;
}

export interface SpellVisual {
  name: string;
  /** The spell whose visual this is, or 0 when no spell of the name has one. */
  spellId: number;
  /** The models that fly from caster to target (an arrow and its glow), if the spell is a missile. */
  missiles: { fileId: number; scale: number }[];
  models: SpellModelRef[];
}

/** A spell model built to be drawn and posed: its scene, its rig, and the sequence to loop. */
export interface SpellModel {
  fileId: number;
  scene: CharacterScene;
  rig: PackedRig;
  /** The sequence played (Stand where it has one) and its length in ms. */
  sequence: number;
  duration: number;
}

const n = (value: unknown): number => Number(value ?? 0);

/** SpellVisualEvent.StartEvent: 1 precast start, 2 precast end, 3 cast, 6 impact, 7 aura start. */
const MOMENTS: Record<number, SpellMoment> = { 1: 'precast', 2: 'precast', 3: 'cast', 6: 'impact', 7: 'aura' };
/** SpellVisualKitEffect.EffectType of a model attached to a unit. */
const EFFECT_MODEL_ATTACH = 2;

export interface SpellVisualTables {
  names: readonly Row[];
  xSpellVisual: readonly Row[];
  visual: readonly Row[];
  missile: readonly Row[];
  event: readonly Row[];
  kitEffect: readonly Row[];
  modelAttach: readonly Row[];
  effectName: readonly Row[];
}

/** Spell visuals looked up in an open folder's tables; the tables are read once and kept. */
export class SpellVisuals {
  private readonly idsByName = new Map<string, number[]>();
  private readonly visualsOfSpell = new Map<number, Row[]>();
  private readonly visualById: Map<number, Row>;
  private readonly missilesBySet = new Map<number, Row[]>();
  private readonly eventsByVisual = new Map<number, Row[]>();
  private readonly effectsByKit = new Map<number, Row[]>();
  private readonly attachById: Map<number, Row>;
  private readonly effectNameById: Map<number, Row>;

  constructor(tables: SpellVisualTables) {
    const group = (rows: readonly Row[], key: string, into: Map<number, Row[]>) => {
      for (const row of rows) {
        const k = n(row[key]);
        let list = into.get(k);
        if (!list) into.set(k, (list = []));
        list.push(row);
      }
    };
    for (const row of tables.names) {
      const key = String(row.Name_lang ?? '').toLowerCase();
      let ids = this.idsByName.get(key);
      if (!ids) this.idsByName.set(key, (ids = []));
      ids.push(n(row.ID));
    }
    group(tables.xSpellVisual.filter((row) => n(row.DifficultyID) === 0), 'SpellID', this.visualsOfSpell);
    this.visualById = new Map(tables.visual.map((row) => [n(row.ID), row]));
    group(tables.missile, 'SpellVisualMissileSetID', this.missilesBySet);
    group(tables.event, 'SpellVisualID', this.eventsByVisual);
    group(tables.kitEffect, 'ParentSpellVisualKitID', this.effectsByKit);
    this.attachById = new Map(tables.modelAttach.map((row) => [n(row.ID), row]));
    this.effectNameById = new Map(tables.effectName.map((row) => [n(row.ID), row]));
  }

  static async load(database: Database): Promise<SpellVisuals> {
    const [names, xSpellVisual, visual, missile, event, kitEffect, modelAttach, effectName] = await Promise.all([
      database.table('SpellName', ['Name_lang']),
      database.table('SpellXSpellVisual', ['SpellID', 'SpellVisualID', 'DifficultyID']),
      database.table('SpellVisual', ['SpellVisualMissileSetID']),
      database.table('SpellVisualMissile', ['SpellVisualEffectNameID', 'SpellVisualMissileSetID']),
      database.table('SpellVisualEvent', ['SpellVisualID', 'SpellVisualKitID', 'StartEvent']),
      database.table('SpellVisualKitEffect', ['Effect', 'EffectType', 'ParentSpellVisualKitID']),
      database.table('SpellVisualKitModelAttach', ['SpellVisualEffectNameID', 'AttachmentID', 'Scale']),
      database.table('SpellVisualEffectName', ['ModelFileDataID', 'Scale']),
    ]);
    return new SpellVisuals({
      names: names.rows, xSpellVisual: xSpellVisual.rows, visual: visual.rows, missile: missile.rows, event: event.rows,
      kitEffect: kitEffect.rows, modelAttach: modelAttach.rows, effectName: effectName.rows,
    });
  }

  /** The visual of one spell by id: the first of its visuals that names a model. */
  ofSpell(spellId: number, name = `Spell ${spellId}`): SpellVisual | undefined {
    for (const row of (this.visualsOfSpell.get(spellId) ?? []).sort((a, b) => n(a.ID) - n(b.ID))) {
      const visual = this.read(n(row.SpellVisualID));
      if (visual.missiles.length > 0 || visual.models.length > 0) return { name, spellId, ...visual };
    }
    return undefined;
  }

  /**
   * For each wanted spell, its visual: the ids given first, in order, then the spells of that
   * name (compared without regard to case), lowest id first, which is the player's own spell
   * in nearly every case. A spell with no model gets an empty visual with spell id 0.
   */
  find(wanted: readonly { name: string; ids?: readonly number[] }[]): SpellVisual[] {
    return wanted.map(({ name, ids = [] }) => {
      const byName = [...(this.idsByName.get(name.toLowerCase()) ?? [])].sort((a, b) => a - b);
      for (const spellId of [...ids, ...byName]) {
        const found = this.ofSpell(spellId, name);
        if (found) return found;
      }
      return { name, spellId: 0, missiles: [], models: [] };
    });
  }

  private effect(id: number): { fileId: number; scale: number } | undefined {
    const row = this.effectNameById.get(id);
    const fileId = n(row?.ModelFileDataID);
    return fileId ? { fileId, scale: n(row?.Scale) || 1 } : undefined;
  }

  private read(visualId: number): Omit<SpellVisual, 'name' | 'spellId'> {
    const set = n(this.visualById.get(visualId)?.SpellVisualMissileSetID);
    const missiles: SpellVisual['missiles'] = [];
    for (const row of set ? (this.missilesBySet.get(set) ?? []) : []) {
      const model = this.effect(n(row.SpellVisualEffectNameID));
      if (model && !missiles.some((m) => m.fileId === model.fileId)) missiles.push(model);
    }
    const models: SpellModelRef[] = [];
    const seen = new Set<string>();
    for (const event of this.eventsByVisual.get(visualId) ?? []) {
      const moment = MOMENTS[n(event.StartEvent)];
      if (!moment) continue;
      for (const effect of this.effectsByKit.get(n(event.SpellVisualKitID)) ?? []) {
        if (n(effect.EffectType) !== EFFECT_MODEL_ATTACH) continue;
        const attach = this.attachById.get(n(effect.Effect));
        const model = attach && this.effect(n(attach.SpellVisualEffectNameID));
        if (!model) continue;
        const attachment = n(attach.AttachmentID);
        // The same model on the same point at the same moment comes from several kits (old and new, caster and target).
        const key = `${model.fileId}:${attachment}:${moment}`;
        if (seen.has(key)) continue;
        seen.add(key);
        models.push({ ...model, scale: model.scale * (n(attach.Scale) || 1), attachment, moment });
      }
    }
    return { missiles, models };
  }
}

/**
 * Build a spell model to draw: its meshes, posed in its Stand (or first) sequence, and a rig
 * to pose it anywhere. Undefined when the file is not on disk or the model has no mesh to
 * draw (all particles and ribbons).
 */
export async function buildSpellModel(storage: CascStorage, fileId: number): Promise<SpellModel | undefined> {
  const readers = sceneReaders(storage);
  const loaded = await readers.readModel(fileId, 'A spell model');
  if (!loaded || loaded.skin.sections.length === 0) return undefined;
  const builder = readers.body(loaded.model, 1);
  const mesh = await builder.buildMesh(loaded.model, loaded.skin, loaded.skin.sections.map(() => true), 'body', `Spell model ${fileId}`);
  if (mesh.draws.length === 0) return undefined;
  const stand = findSequence(loaded.model.sequences, 0);
  const sequence = stand >= 0 ? stand : 0;
  const posed = await builder.pose(sequence, 0);
  builder.apply(posed);
  const scene: CharacterScene = {
    meshes: [mesh],
    textures: builder.textures,
    bounds: posed.bounds,
    problems: readers.problems,
    options: [],
    choices: [],
    animations: builder.animations(),
    presets: [],
    pose: posed.pose,
  };
  const rig = await builder.pack(['Stand']);
  return { fileId, scene, rig, sequence, duration: loaded.model.sequences[sequence]?.duration ?? 0 };
}
