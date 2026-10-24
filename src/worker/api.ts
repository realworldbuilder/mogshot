import type { BuildInfoEntry } from '../casc/build-info';
import type { FileIndexStats } from '../casc/file-index';
import type { OpenStage, StorageInfo } from '../casc/storage';
import type { ClassEntry, Race } from '../character/appearance';
import type { Portraits } from '../character/portraits';
import type { LoadingScreen } from '../character/backdrops';
import type { ClassInfo, ItemSetInfo, ItemSummary, Slot, WeaponKind } from '../character/equipment';
import type { Image } from '../formats/blp';
import type { CharacterScene, PackedRig, PoseRequest, PoseResult } from '../character/scene';
import type { PickedFile } from '../io/file-list-source';
import type { FightSoundName, FightSoundSet, SoundClip, SoundKitClips } from '../character/sounds';
import type { SpellIcon } from '../character/spell-icons';
import type { ImportedRecord } from '../import/record';
import type { ImportResult } from '../import/resolve';

export interface OpenResult {
  info: StorageInfo;
  stats: FileIndexStats;
  products: BuildInfoEntry[];
  /** Time to read and join the indices. */
  ms: number;
}

export type Request =
  | { id: number; method: 'open'; files: PickedFile[]; product?: string }
  | { id: number; method: 'races' }
  | {
      id: number;
      method: 'character';
      raceId: number;
      sex: number;
      choices: [optionId: number, choiceId: number][];
      gear: [slot: Slot, itemId: number][];
      pose: PoseRequest;
    }
  | { id: number; method: 'pose'; sequence: number; time: number }
  | {
      id: number;
      method: 'fighter';
      raceId: number;
      sex: number;
      choices: [optionId: number, choiceId: number][];
      gear: [slot: Slot, itemId: number][];
      /** The animations whose keys are read in advance, so the character can be posed in them at once. */
      animations: string[];
      /**
       * A creature display id: the NPC is built as the game draws it, on the race, sex,
       * appearance choices, item looks and painted body its display names; `raceId` and
       * `sex` are then ignored and `choices` go over the NPC's own. Only a display drawn on a
       * player model works; one with a model of its own is an error.
       */
      npc?: number;
    }
  | { id: number; method: 'creatureDisplays'; ids: number[] }
  | {
      id: number;
      method: 'sounds';
      raceId: number;
      sex: number;
      classId?: number;
      /** The main-hand item, for the weapon's own swing and impact sounds. */
      mainHand?: number;
      /** How the weapon is held, when the item is not known. */
      wielding?: WeaponKind | 'unarmed';
    }
  | { id: number; method: 'searchItems'; slot: Slot; query: string }
  | { id: number; method: 'classList' }
  | { id: number; method: 'portraits' }
  | { id: number; method: 'sets'; classId: number }
  | { id: number; method: 'randomOutfit'; minQuality: number }
  | { id: number; method: 'icon'; fileId: number }
  /** The icon file ids of spells by name, for an action bar; read through 'icon'. */
  | { id: number; method: 'spellIcons'; names: string[] }
  /** The icon file ids of items by id. */
  | { id: number; method: 'itemIcons'; ids: number[] }
  | { id: number; method: 'backdrops' }
  | { id: number; method: 'place'; map: number; x: number; y: number; facing: number; reach: number; z?: number }
  | { id: number; method: 'maps' }
  | { id: number; method: 'resolveImport'; record: ImportedRecord };

export interface ItemSearchResult {
  items: ItemSummary[];
  /** How many items matched in all; `items` holds the first of them. */
  total: number;
}

/** An icon's pixels, or undefined if the file cannot be read. */
export type IconResult = Image | undefined;

/** An item's icon file id, or 0 when the item is unknown or has none. */
export interface ItemIcon {
  id: number;
  fileId: number;
}

/** A map whose outdoor world this install has on disk. */
export interface MapSummary {
  /** The game's map id: 0 Eastern Kingdoms, 1 Kalimdor, 530 Outland, 571 Northrend. */
  id: number;
  name: string;
}

export type { FightSoundName, FightSoundSet, SoundClip, SoundKitClips, SpellIcon };
export type { ClassEntry, ClassInfo, ImportedRecord, ImportResult, ItemSetInfo, ItemSummary, LoadingScreen, PackedRig, Portraits, PoseRequest, PoseResult, Race, Slot, WeaponKind };

export interface CharacterResult {
  scene: CharacterScene;
  ms: number;
}

/** A character built in its Stand pose, with everything the page needs to pose it itself. */
export interface FighterResult {
  scene: CharacterScene;
  rig: PackedRig;
  wielding: WeaponKind | 'unarmed';
  /** The race and sex built: the request's, or for an NPC the ones its display is drawn on. */
  raceId: number;
  sex: number;
  ms: number;
}

/** What the open folder knows of a creature display, for choosing NPCs to offer. */
export interface CreatureLook {
  id: number;
  /** The game's size for it. */
  scale: number;
  /** Set when the display is drawn on a player model, which is the only kind a fighter can be built from. */
  humanoid?: { raceId: number; sex: number };
}

export type Response =
  | { id: number; type: 'progress'; stage: OpenStage }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string; install: boolean };
