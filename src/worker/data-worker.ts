/// <reference lib="webworker" />
import { CascStorage, InstallError, listProducts } from '../casc/storage';
import { Appearance } from '../character/appearance';
import { buildCharacterScene } from '../character/scene';
import { Database } from '../db2/database';
import { Definitions } from '../db2/definitions';
import { FileListSource } from '../io/file-list-source';
import type { CharacterResult, OpenResult, ProbeResult, Request, Response, TableSummary } from './api';

let storage: CascStorage | undefined;
let database: Database | undefined;
// Loaded from the database the first time a character is asked for.
let appearance: Promise<Appearance> | undefined;

const definitions = new Definitions(async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
});

const post = (message: Response, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);

async function handle(request: Request): Promise<{ value: unknown; transfer?: Transferable[] }> {
  switch (request.method) {
    case 'open': {
      const source = new FileListSource(request.files);
      const start = performance.now();
      const products = await listProducts(source);
      storage = await CascStorage.open(source, {
        product: request.product,
        onProgress: (stage) => post({ id: request.id, type: 'progress', stage }),
      });
      database = new Database(storage, definitions);
      appearance = undefined;
      const value: OpenResult = {
        info: storage.info,
        stats: storage.files.stats,
        products,
        ms: performance.now() - start,
      };
      return { value };
    }
    case 'probe': {
      if (!storage) throw new Error('No folder is open');
      const start = performance.now();
      const entry = storage.files.find(request.fileId);
      const file = await storage.readFile(request.fileId);
      const head = file ? file.data.slice(0, 256) : new Uint8Array(0);
      const value: ProbeResult = {
        status: file ? 'ok' : storage.files.isMissing(request.fileId) ? 'missing' : 'unknown',
        size: file?.data.length ?? 0,
        head,
        encryptedChunks: file?.encrypted.length ?? 0,
        highRes: entry?.highRes ?? false,
        highResMissing: entry?.highResMissing ?? false,
        ms: performance.now() - start,
      };
      return { value, transfer: [head.buffer] };
    }
    case 'character': {
      if (!storage || !database) throw new Error('No folder is open');
      const start = performance.now();
      appearance ??= Appearance.load(database);
      let loaded: Appearance;
      try {
        loaded = await appearance;
      } catch (error) {
        appearance = undefined; // let the next request try again
        throw error;
      }
      const scene = await buildCharacterScene(storage, loaded, { raceId: request.raceId, sex: request.sex });
      const value: CharacterResult = { scene, ms: performance.now() - start };
      const transfer = [scene.vertices.buffer, scene.indices.buffer, scene.bones.buffer];
      // A texture can be used by more than one slot; each buffer may be transferred once.
      for (const buffer of new Set(scene.textures.map((texture) => texture.pixels.buffer))) transfer.push(buffer);
      return { value, transfer };
    }
    case 'tableSummary': {
      if (!database) throw new Error('No folder is open');
      const start = performance.now();
      const table = await database.table(request.table, []);
      const value: TableSummary = {
        rows: table.rows.length,
        encryptedRows: table.skipped.reduce((n, section) => n + section.rowCount, 0),
        ms: performance.now() - start,
      };
      return { value };
    }
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const { value, transfer } = await handle(request);
    post({ id: request.id, type: 'result', value }, transfer);
  } catch (error) {
    post({
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      install: error instanceof InstallError,
    });
  }
};
