/// <reference lib="webworker" />
import { CascStorage, InstallError, listProducts } from '../casc/storage';
import { Appearance } from '../character/appearance';
import { buildCharacterScene } from '../character/scene';
import { Database } from '../db2/database';
import { Definitions } from '../db2/definitions';
import { FileListSource } from '../io/file-list-source';
import type { CharacterResult, OpenResult, Request, Response } from './api';

let storage: CascStorage | undefined;
let database: Database | undefined;
let appearance: Promise<Appearance> | undefined;

const definitions = new Definitions(async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
});

const post = (message: Response, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);

/** The appearance data, loaded from the database the first time it is needed. */
async function loadAppearance(): Promise<Appearance> {
  if (!database) throw new Error('No folder is open');
  appearance ??= Appearance.load(database);
  try {
    return await appearance;
  } catch (error) {
    appearance = undefined; // let the next request try again
    throw error;
  }
}

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
    case 'races':
      return { value: (await loadAppearance()).races };
    case 'character': {
      if (!storage) throw new Error('No folder is open');
      const start = performance.now();
      const scene = await buildCharacterScene(storage, await loadAppearance(), {
        raceId: request.raceId,
        sex: request.sex,
        choices: new Map(request.choices),
      });
      const value: CharacterResult = { scene, ms: performance.now() - start };
      // A buffer may be transferred once, and the same pixels can back more than one texture.
      const buffers = new Set<ArrayBufferLike>(scene.textures.map((texture) => texture.pixels.buffer));
      for (const mesh of scene.meshes) {
        buffers.add(mesh.vertices.buffer).add(mesh.indices.buffer).add(mesh.bones.buffer);
      }
      return { value, transfer: [...buffers] as Transferable[] };
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
