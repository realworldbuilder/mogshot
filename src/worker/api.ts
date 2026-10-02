import type { BuildInfoEntry } from '../casc/build-info';
import type { FileIndexStats } from '../casc/file-index';
import type { OpenStage, StorageInfo } from '../casc/storage';
import type { Race } from '../character/appearance';
import type { ItemSummary, Slot } from '../character/equipment';
import type { Image } from '../formats/blp';
import type { CharacterScene } from '../character/scene';
import type { PickedFile } from '../io/file-list-source';

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
    }
  | { id: number; method: 'searchItems'; slot: Slot; query: string }
  | { id: number; method: 'icon'; fileId: number };

export interface ItemSearchResult {
  items: ItemSummary[];
  /** How many items matched in all; `items` holds the first of them. */
  total: number;
}

/** An icon's pixels, or undefined if the file cannot be read. */
export type IconResult = Image | undefined;

export type { ItemSummary, Race, Slot };

export interface CharacterResult {
  scene: CharacterScene;
  ms: number;
}

export type Response =
  | { id: number; type: 'progress'; stage: OpenStage }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string; install: boolean };
