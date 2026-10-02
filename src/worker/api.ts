import type { BuildInfoEntry } from '../casc/build-info';
import type { FileIndexStats } from '../casc/file-index';
import type { OpenStage, StorageInfo } from '../casc/storage';
import type { PickedFile } from '../io/file-list-source';

/** The folder the user picked, in a form that can be posted to the worker. */
export type FolderSource =
  | { kind: 'handle'; handle: FileSystemDirectoryHandle }
  | { kind: 'files'; files: PickedFile[] };

export interface OpenResult {
  info: StorageInfo;
  stats: FileIndexStats;
  products: BuildInfoEntry[];
  /** Time to read and join the indices. */
  ms: number;
}

export interface ProbeResult {
  /** 'missing' = the build lists the file but it is not installed; 'unknown' = not in this build. */
  status: 'ok' | 'missing' | 'unknown';
  size: number;
  /** First bytes of the decoded file. */
  head: Uint8Array;
  encryptedChunks: number;
  highRes: boolean;
  highResMissing: boolean;
  ms: number;
}

export type Request =
  | { id: number; method: 'open'; source: FolderSource; product?: string }
  | { id: number; method: 'probe'; fileId: number };

export type Response =
  | { id: number; type: 'progress'; stage: OpenStage }
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string; install: boolean };
