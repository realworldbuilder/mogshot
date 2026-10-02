import type { BuildInfoEntry } from '../casc/build-info';
import type { FileIndexStats } from '../casc/file-index';
import type { OpenStage, StorageInfo } from '../casc/storage';
import type { Race } from '../character/appearance';
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
  | { id: number; method: 'character'; raceId: number; sex: number; choices: [optionId: number, choiceId: number][] };

export type { Race };

export interface CharacterResult {
  scene: CharacterScene;
  ms: number;
}

export type Response =
  | { id: number; type: 'progress'; stage: OpenStage }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string; install: boolean };
