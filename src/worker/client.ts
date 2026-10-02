import type { OpenStage } from '../casc/storage';
import type { PickedFile } from '../io/file-list-source';
import type { CharacterResult, OpenResult, ProbeResult, Request, Response, TableSummary } from './api';

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

  probe(fileId: number): Promise<ProbeResult> {
    return this.call({ method: 'probe', fileId });
  }

  character(raceId: number, sex: number): Promise<CharacterResult> {
    return this.call({ method: 'character', raceId, sex });
  }

  tableSummary(table: string): Promise<TableSummary> {
    return this.call({ method: 'tableSummary', table });
  }
}
