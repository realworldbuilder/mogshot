import type { PlaceScene } from '../world/place';
import type { OpenStage } from '../casc/storage';
import type { PickedFile } from '../io/file-list-source';
import type {
  CharacterResult,
  ClassInfo,
  ImportedRecord,
  ImportResult,
  ItemSetInfo,
  ItemSummary,
  IconResult,
  ItemSearchResult,
  LoadingScreen,
  OpenResult,
  PoseRequest,
  PoseResult,
  Race,
  Request,
  Response,
  Slot,
} from './api';

/** An error the worker raised. `install` means the folder itself is the problem. */
export class DataError extends Error {
  constructor(
    message: string,
    readonly install: boolean,
  ) {
    super(message);
  }
}

type RequestBody = Request extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/** The page's side of the data worker: all file reading and parsing happens over there. */
export class DataClient {
  private readonly worker = new Worker(new URL('./data-worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; onProgress?: (stage: OpenStage) => void }
  >();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<Response>) => {
      const message = event.data;
      const call = this.pending.get(message.id);
      if (!call) return;
      if (message.type === 'progress') return call.onProgress?.(message.stage);
      this.pending.delete(message.id);
      if (message.type === 'result') call.resolve(message.value);
      else call.reject(new DataError(message.message, message.install));
    };
  }

  private call<T>(body: RequestBody, onProgress?: (stage: OpenStage) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
      this.worker.postMessage({ id, ...body });
    });
  }

  open(files: PickedFile[], product?: string, onProgress?: (stage: OpenStage) => void): Promise<OpenResult> {
    return this.call({ method: 'open', files, product }, onProgress);
  }

  races(): Promise<Race[]> {
    return this.call({ method: 'races' });
  }

  character(
    raceId: number,
    sex: number,
    choices: [number, number][],
    gear: [Slot, number][],
    pose: PoseRequest,
  ): Promise<CharacterResult> {
    return this.call({ method: 'character', raceId, sex, choices, gear, pose });
  }

  /** Pose the character last built at a moment of one of its sequences. */
  pose(sequence: number, time: number): Promise<PoseResult> {
    return this.call({ method: 'pose', sequence, time });
  }

  searchItems(slot: Slot, query: string): Promise<ItemSearchResult> {
    return this.call({ method: 'searchItems', slot, query });
  }

  classes(raceId: number): Promise<ClassInfo[]> {
    return this.call({ method: 'classes', raceId });
  }

  sets(classId: number): Promise<ItemSetInfo[]> {
    return this.call({ method: 'sets', classId });
  }

  randomOutfit(minQuality: number): Promise<[Slot, ItemSummary][]> {
    return this.call({ method: 'randomOutfit', minQuality });
  }

  /** An icon's or a loading screen's pixels. */
  icon(fileId: number): Promise<IconResult> {
    return this.call({ method: 'icon', fileId });
  }

  /** The game world around a spot, for the character to stand in. `facing` is in radians. */
  place(map: number, x: number, y: number, facing: number, reach: number): Promise<PlaceScene> {
    return this.call({ method: 'place', map, x, y, facing, reach });
  }

  /** The game's loading screens, by name. */
  backdrops(): Promise<LoadingScreen[]> {
    return this.call({ method: 'backdrops' });
  }

  /** A captured character as the game data of the open folder has it. */
  resolveImport(record: ImportedRecord): Promise<ImportResult> {
    return this.call({ method: 'resolveImport', record });
  }
}
