import type { CascStorage } from '../casc/storage';
import type { Database } from '../db2/database';
import type { Row } from '../db2/wdc';
import type { WeaponKind } from './equipment';

/*
 * The sounds of a fight, found in the game's own tables the way the client finds them:
 *
 * - a weapon's swing is WeaponSwingSounds2 by the swing size ItemSubClass gives its subclass;
 * - a hit is WeaponImpactSounds for the subclass, slot 0 of the array (flesh); a crit is the
 *   CritImpactSoundID beside it; a parry is slot 5 (metal on metal);
 * - a race's voice is CreatureSoundData, reached from the race's model through
 *   ChrRaceXChrModel, ChrModel and CreatureDisplayInfo (or its CreatureModelData);
 * - the roar and cheer are EmotesTextSound rows for the race and sex;
 * - a spell's cast and impact are the sound effects of the SpellVisualKits that
 *   SpellVisualEvent plays for the spell's visual, found through SpellXSpellVisual;
 * - the gong and the duelling flag are SoundKit rows by number: SoundKitName does not ship
 *   with the game, so these three were identified once through the community listfile.
 *
 * Every id here is a SoundKit (the SoundEntries of old); SoundKitEntry lists each kit's files.
 */

/** What a fight needs a sound for. */
export type FightSoundName =
  | 'swing'
  | 'swingCrit'
  | 'hit'
  | 'crit'
  | 'block'
  | 'cast'
  | 'impact'
  | 'exert'
  | 'exertCrit'
  | 'injury'
  | 'injuryCrit'
  | 'death'
  | 'roar'
  | 'cheer'
  | 'gong'
  | 'flagUp'
  | 'flagDown';

export const FIGHT_SOUND_NAMES: readonly FightSoundName[] = [
  'swing', 'swingCrit', 'hit', 'crit', 'block', 'cast', 'impact',
  'exert', 'exertCrit', 'injury', 'injuryCrit', 'death', 'roar', 'cheer',
  'gong', 'flagUp', 'flagDown',
];

/** One file of a sound kit, read from the archives. */
export interface SoundClip {
  fileId: number;
  /** 'ogg' or 'mp3', from the file's first bytes. */
  format: 'ogg' | 'mp3';
  /** The kit's volume times the entry's. */
  volume: number;
  /** How often this file is picked relative to the kit's others. */
  weight: number;
  bytes: Uint8Array;
}

/** A sound kit with its files. The page picks one clip by weight each time it plays the kit. */
export interface SoundKitClips {
  kit: number;
  /** Playback rate spread: [below, above] 1, as fractions. */
  pitchVariation: [number, number];
  clips: SoundClip[];
}

/** Everything a fighter's side of a fight sounds like. */
export interface FightSoundSet {
  /** The kit chosen for each sound; missing when the tables have none. */
  sounds: Partial<Record<FightSoundName, number>>;
  /** The chosen kits' files, by kit id. */
  kits: Record<number, SoundKitClips>;
  problems: string[];
  ms: number;
}

export interface FightSoundChoice {
  raceId: number;
  /** 0 male, 1 female. */
  sex: number;
  /** Chooses the spell: a mage throws a Fireball, a warlock a Shadow Bolt. */
  classId?: number;
  /** The main hand's Item subclass, for the weapon's own sounds. */
  weaponSubclass?: number;
  /** When no item is known: how the weapon is held, mapped to a typical subclass. */
  wielding?: WeaponKind | 'unarmed';
}

const n = (value: unknown): number => Number(value ?? 0);

/** Item subclasses of class 2 (Weapon). */
const SUBCLASS_BOW = 2;
const SUBCLASS_GUN = 3;
const SUBCLASS_SWORD_1H = 7;
const SUBCLASS_SWORD_2H = 8;
const SUBCLASS_STAFF = 10;
const SUBCLASS_FIST = 13;
const SUBCLASS_THROWN = 16;
const SUBCLASS_CROSSBOW = 18;

const SUBCLASS_OF_WIELDING: Record<WeaponKind | 'unarmed', number> = {
  unarmed: SUBCLASS_FIST,
  oneHand: SUBCLASS_SWORD_1H,
  twoHand: SUBCLASS_SWORD_2H,
  long: SUBCLASS_STAFF,
  bow: SUBCLASS_BOW,
  rifle: SUBCLASS_GUN,
  crossbow: SUBCLASS_CROSSBOW,
  thrown: SUBCLASS_THROWN,
};

/** Slots of WeaponImpactSounds' arrays: what the weapon hits. */
const IMPACT_FLESH = 0;
const IMPACT_PARRY = 5;

/** The spell each class throws as its special, and the one anybody else throws. */
const SPELL_OF_CLASS: Record<number, number> = {
  2: 879, // paladin: Exorcism
  3: 3044, // hunter: Arcane Shot
  5: 585, // priest: Smite
  7: 403, // shaman: Lightning Bolt
  8: 133, // mage: Fireball
  9: 686, // warlock: Shadow Bolt
  11: 5176, // druid: Wrath
};
const DEFAULT_SPELL = 133;

/** SpellVisualEvent.StartEvent values: the cast's release and the hit on the target. */
const EVENT_CAST = 3;
const EVENT_IMPACT = 6;
/** SpellVisualEvent.TargetType: the caster, the target. */
const TARGET_CASTER = 1;
const TARGET_TARGET = 2;
/** SpellVisualKitEffect.EffectType for a sound kit. */
const EFFECT_SOUND = 5;

/** SoundKit.Flags: the kit loops (a precast hum), so it is no one-shot. */
const FLAG_LOOPING = 0x200;

/**
 * SoundKit rows without a table that names them for us: the troll gong doodad
 * (sound/doodad/g_gongtroll01.ogg), and the duelling flag planting and leaving
 * (sound/doodad/duelingflagspawn.ogg, duelingflagdespawn.ogg).
 */
const KIT_GONG = 4654;
const KIT_FLAG_UP = 3486;
const KIT_FLAG_DOWN = 3487;

interface KitInfo {
  volume: number;
  flags: number;
  pitchVariation: [number, number];
  entries: { fileId: number; weight: number; volume: number }[];
}

interface VoiceRow {
  exert: number;
  exertCrit: number;
  injury: number;
  injuryCrit: number;
  death: number;
  aggro: number;
  battleShout: number;
}

export class Sounds {
  private constructor(
    private readonly kits: Map<number, KitInfo>,
    /** Swing size (0 small, 1 medium, 2 large) and crit (0, 1) to the kit. */
    private readonly swings: Map<string, number>,
    /** Weapon subclass to its swing size. */
    private readonly swingSizes: Map<number, number>,
    /** Weapon subclass to the first WeaponImpactSounds row for it. */
    private readonly impacts: Map<number, { hit: number[]; crit: number[] }>,
    /** Race and sex ("1/0") to the voice. */
    private readonly voices: Map<string, VoiceRow>,
    /** Emote name, race and sex ("ROAR/1/0") to the kit. */
    private readonly emotes: Map<string, number>,
    /** Spell id to its cast and impact kits. */
    private readonly spells: Map<number, { cast: number; impact: number }>,
  ) {}

  static async load(database: Database): Promise<Sounds> {
    const [kitRows, entryRows, swingRows, swingSizeRows, impactRows, raceModels, models, displays, modelData, soundData, emoteTexts, emoteSounds, spellVisuals, events, effects] =
      await Promise.all([
        database.table('SoundKit', ['VolumeFloat', 'Flags', 'PitchVariationMinus', 'PitchVariationPlus']),
        database.table('SoundKitEntry', ['FileDataID', 'SoundKitID', 'Frequency', 'Volume']),
        database.table('WeaponSwingSounds2', ['SwingType', 'Crit', 'SoundID']),
        database.table('ItemSubClass', ['ClassID', 'SubClassID', 'WeaponSwingSize']),
        database.table('WeaponImpactSounds', ['WeaponSubClassID', 'ImpactSoundID', 'CritImpactSoundID']),
        database.table('ChrRaceXChrModel', ['ChrRacesID', 'ChrModelID', 'Sex']),
        database.table('ChrModel', ['DisplayID']),
        database.table('CreatureDisplayInfo', ['ModelID', 'SoundID']),
        database.table('CreatureModelData', ['SoundID']),
        database.table('CreatureSoundData', [
          'SoundExertionID', 'SoundExertionCriticalID', 'SoundInjuryID', 'SoundInjuryCriticalID', 'SoundDeathID', 'SoundAggroID', 'BattleShoutSoundID',
        ]),
        database.table('EmotesText', ['Name']),
        database.table('EmotesTextSound', ['EmotesTextID', 'RaceID', 'SexID', 'SoundID', 'ClassID']),
        database.table('SpellXSpellVisual', ['SpellID', 'SpellVisualID']),
        database.table('SpellVisualEvent', ['SpellVisualID', 'SpellVisualKitID', 'StartEvent', 'TargetType']),
        database.table('SpellVisualKitEffect', ['Effect', 'EffectType', 'ParentSpellVisualKitID']),
      ]);

    const kits = new Map<number, KitInfo>();
    for (const row of kitRows.rows) {
      kits.set(n(row[kitRows.idColumn]), {
        volume: Number(row.VolumeFloat ?? 1),
        flags: n(row.Flags),
        pitchVariation: [Number(row.PitchVariationMinus ?? 0), Number(row.PitchVariationPlus ?? 0)],
        entries: [],
      });
    }
    for (const row of entryRows.rows) {
      const kit = kits.get(n(row.SoundKitID));
      if (!kit) continue;
      kit.entries.push({ fileId: n(row.FileDataID), weight: Math.max(1, n(row.Frequency)), volume: Number(row.Volume ?? 1) });
    }

    const swings = new Map<string, number>();
    for (const row of swingRows.rows) swings.set(`${n(row.SwingType)}/${n(row.Crit)}`, n(row.SoundID));
    const swingSizes = new Map<number, number>();
    for (const row of swingSizeRows.rows) if (n(row.ClassID) === 2) swingSizes.set(n(row.SubClassID), n(row.WeaponSwingSize));

    const impacts = new Map<number, { hit: number[]; crit: number[] }>();
    for (const row of impactRows.rows) {
      const subclass = n(row.WeaponSubClassID);
      if (impacts.has(subclass)) continue;
      impacts.set(subclass, { hit: (row.ImpactSoundID as number[]) ?? [], crit: (row.CritImpactSoundID as number[]) ?? [] });
    }

    // Race and sex to the model's CreatureSoundData row.
    const displayOfModel = new Map(models.rows.map((row) => [n(row[models.idColumn]), n(row.DisplayID)]));
    const displayById = new Map(displays.rows.map((row) => [n(row[displays.idColumn]), row]));
    const modelDataSound = new Map(modelData.rows.map((row) => [n(row[modelData.idColumn]), n(row.SoundID)]));
    const voiceById = new Map<number, VoiceRow>(
      soundData.rows.map((row) => [
        n(row[soundData.idColumn]),
        {
          exert: n(row.SoundExertionID),
          exertCrit: n(row.SoundExertionCriticalID),
          injury: n(row.SoundInjuryID),
          injuryCrit: n(row.SoundInjuryCriticalID),
          death: n(row.SoundDeathID),
          aggro: n(row.SoundAggroID),
          battleShout: n(row.BattleShoutSoundID),
        },
      ]),
    );
    const voices = new Map<string, VoiceRow>();
    for (const link of raceModels.rows) {
      const display = displayById.get(displayOfModel.get(n(link.ChrModelID)) ?? 0);
      if (!display) continue;
      const voice = voiceById.get(n(display.SoundID) || (modelDataSound.get(n(display.ModelID)) ?? 0));
      if (voice) voices.set(`${n(link.ChrRacesID)}/${n(link.Sex)}`, voice);
    }

    const emoteName = new Map(emoteTexts.rows.map((row) => [n(row[emoteTexts.idColumn]), String(row.Name ?? '')]));
    const emotes = new Map<string, number>();
    for (const row of emoteSounds.rows) {
      const name = emoteName.get(n(row.EmotesTextID));
      if (!name || n(row.SoundID) === 0) continue;
      const key = `${name}/${n(row.RaceID)}/${n(row.SexID)}`;
      // A row for every class beats one for a single class.
      if (n(row.ClassID) === 0 || !emotes.has(key)) emotes.set(key, n(row.SoundID));
    }

    // Spells: the first visual's cast-release and target-impact kits' sound effects.
    const soundsOfKit = new Map<number, number[]>();
    for (const row of effects.rows) {
      if (n(row.EffectType) !== EFFECT_SOUND) continue;
      const kit = n(row.ParentSpellVisualKitID);
      if (!soundsOfKit.has(kit)) soundsOfKit.set(kit, []);
      soundsOfKit.get(kit)!.push(n(row.Effect));
    }
    const eventsOfVisual = new Map<number, Row[]>();
    for (const row of events.rows) {
      const visual = n(row.SpellVisualID);
      if (!eventsOfVisual.has(visual)) eventsOfVisual.set(visual, []);
      eventsOfVisual.get(visual)!.push(row);
    }
    const oneShot = (ids: number[]) => ids.find((id) => id > 0 && kits.has(id) && (kits.get(id)!.flags & FLAG_LOOPING) === 0) ?? 0;
    const spells = new Map<number, { cast: number; impact: number }>();
    const wanted = new Set([DEFAULT_SPELL, ...Object.values(SPELL_OF_CLASS)]);
    for (const row of spellVisuals.rows) {
      const spell = n(row.SpellID);
      if (!wanted.has(spell) || spells.has(spell)) continue;
      const visualEvents = eventsOfVisual.get(n(row.SpellVisualID)) ?? [];
      const soundsAt = (event: number, target: number) =>
        visualEvents.filter((e) => n(e.StartEvent) === event && n(e.TargetType) === target).flatMap((e) => soundsOfKit.get(n(e.SpellVisualKitID)) ?? []);
      const cast = oneShot(soundsAt(EVENT_CAST, TARGET_CASTER));
      const impact = oneShot([...soundsAt(EVENT_IMPACT, TARGET_TARGET), ...soundsAt(EVENT_IMPACT, TARGET_CASTER)]);
      if (cast || impact) spells.set(spell, { cast, impact });
    }

    return new Sounds(kits, swings, swingSizes, impacts, voices, emotes, spells);
  }

  /** The kit for each sound of a fight, and what could not be found. */
  choose(choice: FightSoundChoice): { sounds: Partial<Record<FightSoundName, number>>; problems: string[] } {
    const sounds: Partial<Record<FightSoundName, number>> = {};
    const problems: string[] = [];
    const set = (name: FightSoundName, ...candidates: number[]) => {
      const kit = candidates.find((id) => id > 0 && this.kits.has(id));
      if (kit === undefined) problems.push(`no ${name} sound`);
      else sounds[name] = kit;
    };

    const subclass = choice.weaponSubclass ?? SUBCLASS_OF_WIELDING[choice.wielding ?? 'unarmed'];
    const size = this.swingSizes.get(subclass) ?? 0;
    set('swing', this.swings.get(`${size}/0`) ?? 0, this.swings.get('0/0') ?? 0);
    set('swingCrit', this.swings.get(`${size}/1`) ?? 0, this.swings.get(`${size}/0`) ?? 0);
    const impact = this.impacts.get(subclass) ?? this.impacts.get(SUBCLASS_SWORD_1H);
    set('hit', impact?.hit[IMPACT_FLESH] ?? 0);
    set('crit', impact?.crit[IMPACT_FLESH] ?? 0, impact?.hit[IMPACT_FLESH] ?? 0);
    set('block', impact?.hit[IMPACT_PARRY] ?? 0, this.impacts.get(SUBCLASS_SWORD_1H)?.hit[IMPACT_PARRY] ?? 0);

    // The class's spell, with the default's sounds standing in for any it lacks.
    const spell = this.spells.get(SPELL_OF_CLASS[choice.classId ?? 0] ?? DEFAULT_SPELL);
    const fallback = this.spells.get(DEFAULT_SPELL);
    set('cast', spell?.cast ?? 0, fallback?.cast ?? 0);
    set('impact', spell?.impact ?? 0, fallback?.impact ?? 0);

    const voice = this.voices.get(`${choice.raceId}/${choice.sex}`);
    if (!voice) problems.push(`race ${choice.raceId} sex ${choice.sex} has no voice`);
    set('exert', voice?.exert ?? 0);
    set('exertCrit', voice?.exertCrit ?? 0, voice?.exert ?? 0);
    set('injury', voice?.injury ?? 0);
    set('injuryCrit', voice?.injuryCrit ?? 0, voice?.injury ?? 0);
    set('death', voice?.death ?? 0);
    const emote = (name: string) => this.emotes.get(`${name}/${choice.raceId}/${choice.sex}`) ?? 0;
    // The /roar emote's line, or the nearest thing this race shouts.
    set('roar', emote('ROAR'), voice?.aggro ?? 0, voice?.battleShout ?? 0, emote('CHARGE'), voice?.exertCrit ?? 0);
    set('cheer', emote('CHEER'), emote('VICTORY'), voice?.battleShout ?? 0);

    set('gong', KIT_GONG);
    set('flagUp', KIT_FLAG_UP);
    set('flagDown', KIT_FLAG_DOWN);
    return { sounds, problems };
  }

  /** A kit's description, without its files. */
  kit(id: number): { volume: number; pitchVariation: [number, number]; entries: { fileId: number; weight: number; volume: number }[] } | undefined {
    return this.kits.get(id);
  }
}

const OGG_MAGIC = 0x4f676753; // 'OggS'

/** The sound format a file's first bytes announce, or undefined for something else (a BLP, say). */
export function soundFormat(bytes: Uint8Array): 'ogg' | 'mp3' | undefined {
  if (bytes.length < 4) return undefined;
  const head = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  if (head === OGG_MAGIC) return 'ogg';
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'mp3'; // ID3 tag
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'mp3'; // frame sync
  return undefined;
}

/** Choose a fight's sounds and read their files. */
export async function loadFightSounds(storage: CascStorage, sounds: Sounds, choice: FightSoundChoice): Promise<FightSoundSet> {
  const start = performance.now();
  const chosen = sounds.choose(choice);
  const problems = [...chosen.problems];
  const kits: Record<number, SoundKitClips> = {};
  await Promise.all(
    [...new Set(Object.values(chosen.sounds))].map(async (id) => {
      const kit = sounds.kit(id)!;
      const clips: SoundClip[] = [];
      for (const entry of kit.entries) {
        const file = await storage.readFile(entry.fileId);
        if (!file) {
          problems.push(`kit ${id}: file ${entry.fileId} is not on disk`);
          continue;
        }
        const format = soundFormat(file.data);
        if (!format) {
          problems.push(`kit ${id}: file ${entry.fileId} is not a sound`);
          continue;
        }
        clips.push({ fileId: entry.fileId, format, volume: kit.volume * entry.volume, weight: entry.weight, bytes: file.data });
      }
      kits[id] = { kit: id, pitchVariation: kit.pitchVariation, clips };
    }),
  );
  for (const [name, id] of Object.entries(chosen.sounds) as [FightSoundName, number][]) {
    if (kits[id]!.clips.length === 0) {
      problems.push(`${name}: kit ${id} has no readable file`);
      delete chosen.sounds[name];
    }
  }
  return { sounds: chosen.sounds, kits, problems, ms: performance.now() - start };
}
