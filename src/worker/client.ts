import type { PlaceScene } from '../world/place';
import type { OpenStage } from '../casc/storage';
import type { PickedFile } from '../io/file-list-source';
import type {
  CharacterResult,
  ClassEntry,
  CreatureLook,
  FighterResult,
  FightSoundSet,
  ImportedRecord,
  ImportResult,
  ItemSetInfo,
  ItemSummary,
  IconResult,
  ItemSearchResult,
  LoadingScreen,
  OpenResult,
  Portraits,
  PoseRequest,
  PoseResult,
  Race,
  Request,
  Response,
  Slot,
  WeaponKind,
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
  /**
   * Build a character and hand over everything needed to pose it on this thread, with the
   * named animations ready. With `npc`, a creature display id, the NPC is built as the game
   * draws it and `raceId` and `sex` are ignored.
   */
  fighter(raceId: number, sex: number, choices: [number, number][], gear: [Slot, number][], animations: string[], npc?: number): Promise<FighterResult> {
    return this.call({ method: 'fighter', raceId, sex, choices, gear, animations, ...(npc !== undefined && { npc }) });
  }

  /** The creature displays the open folder has among `ids`, in that order, with the race and sex of each one drawn on a player model. */
  creatureDisplays(ids: number[]): Promise<CreatureLook[]> {
    return this.call({ method: 'creatureDisplays', ids });
  }

  /**
   * The sounds of a fight for one fighter: weapon swings and impacts, the race's voice, a spell,
   * the gong. `mainHand` is the item whose weapon sounds to use; `wielding` stands in when there is none.
   */
  sounds(raceId: number, sex: number, classId?: number, mainHand?: number, wielding?: WeaponKind | 'unarmed'): Promise<FightSoundSet> {
    const request: Extract<RequestBody, { method: 'sounds' }> = { method: 'sounds', raceId, sex };
    if (classId !== undefined) request.classId = classId;
    if (mainHand !== undefined) request.mainHand = mainHand;
    if (wielding !== undefined) request.wielding = wielding;
    return this.call(request);
  }

  pose(sequence: number, time: number): Promise<PoseResult> {
    return this.call({ method: 'pose', sequence, time });
  }

  searchItems(slot: Slot, query: string): Promise<ItemSearchResult> {
    return this.call({ method: 'searchItems', slot, query });
  }

  /** Every class some race can be, in the game's order, with the races that can be it. */
  classList(): Promise<ClassEntry[]> {
    return this.call({ method: 'classList' });
  }

  /** The race and class pictures of the character creation screen, from the game's interface atlas. */
  portraits(): Promise<Portraits> {
    return this.call({ method: 'portraits' });
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
