import type { BuildInfoEntry } from '../casc/build-info';
import type { FileIndexStats } from '../casc/file-index';
import type { OpenStage, StorageInfo } from '../casc/storage';
import type { Race } from '../character/appearance';
import type { ClassInfo, ItemSetInfo, ItemSummary, Slot } from '../character/equipment';
import type { Image } from '../formats/blp';
import type { CharacterScene, PoseRequest, PoseResult } from '../character/scene';
import type { PickedFile } from '../io/file-list-source';
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
  | { id: number; method: 'searchItems'; slot: Slot; query: string }
  | { id: number; method: 'classes'; raceId: number }
  | { id: number; method: 'sets'; classId: number }
  | { id: number; method: 'randomOutfit'; minQuality: number }
  | { id: number; method: 'icon'; fileId: number }
  | { id: number; method: 'resolveImport'; record: ImportedRecord };

export interface ItemSearchResult {
  items: ItemSummary[];
  /** How many items matched in all; `items` holds the first of them. */
  total: number;
}

/** An icon's pixels, or undefined if the file cannot be read. */
export type IconResult = Image | undefined;

export type { ClassInfo, ImportedRecord, ImportResult, ItemSetInfo, ItemSummary, PoseRequest, PoseResult, Race, Slot };

export interface CharacterResult {
  scene: CharacterScene;
  ms: number;
}

export type Response =
  | { id: number; type: 'progress'; stage: OpenStage }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string; install: boolean };
