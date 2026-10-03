/// <reference lib="webworker" />
import { IndexedDbCache } from '../casc/cache';
import { CascStorage, InstallError, listProducts } from '../casc/storage';
import { Appearance } from '../character/appearance';
import { Equipment } from '../character/equipment';
import { buildCharacterScene, type CharacterRig } from '../character/scene';
import { Database } from '../db2/database';
import { Definitions } from '../db2/definitions';
import { decodeBlp } from '../formats/blp';
import { resolveImport } from '../import/resolve';
import { FileListSource } from '../io/file-list-source';
import type { CharacterResult, IconResult, ItemSearchResult, OpenResult, Request, Response } from './api';

let storage: CascStorage | undefined;
let database: Database | undefined;
let appearance: Promise<Appearance> | undefined;
let equipment: Promise<Equipment> | undefined;
// The character last built, kept so it can be posed again without rebuilding.
let rig: CharacterRig | undefined;

const cache = new IndexedDbCache();
const definitions = new Definitions(async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}, cache);

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

/** The item data, loaded from the database the first time it is needed. */
async function loadEquipment(): Promise<Equipment> {
  if (!database) throw new Error('No folder is open');
  equipment ??= Equipment.load(database);
  try {
    return await equipment;
  } catch (error) {
    equipment = undefined;
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
        cache,
      });
      database = new Database(storage, definitions);
      appearance = undefined;
      equipment = undefined;
      rig = undefined;
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
      // The item tables are only read once something is worn.
      const items = request.gear.length > 0 ? await loadEquipment() : undefined;
      const built = await buildCharacterScene(storage, await loadAppearance(), items, {
        raceId: request.raceId,
        sex: request.sex,
        choices: new Map(request.choices),
        gear: new Map(request.gear),
        pose: request.pose,
      });
      rig = built.rig;
      const { scene } = built;
      const value: CharacterResult = { scene, ms: performance.now() - start };
      // A buffer may be transferred once, and the same pixels can back more than one texture.
      const buffers = new Set<ArrayBufferLike>(scene.textures.map((texture) => texture.pixels.buffer));
      for (const mesh of scene.meshes) {
        // The vertices are copied, not moved: the rig keeps them to measure each new pose.
        buffers.add(mesh.indices.buffer).add(mesh.bones.buffer).add(mesh.transform.buffer);
      }
      return { value, transfer: [...buffers] as Transferable[] };
    }
    case 'pose': {
      if (!rig) throw new Error('No character has been built');
      const value = await rig.pose(request.sequence, request.time);
      return { value, transfer: value.meshes.flatMap((mesh) => [mesh.bones.buffer, mesh.transform.buffer]) as Transferable[] };
    }
    case 'searchItems': {
      const value: ItemSearchResult = (await loadEquipment()).search(request.slot, request.query);
      return { value };
    }
    case 'classes':
      return { value: (await loadEquipment()).classes(request.raceId) };
    case 'sets':
      return { value: (await loadEquipment()).sets(request.classId) };
    case 'randomOutfit':
      return { value: (await loadEquipment()).randomOutfit(request.minQuality) };
    case 'resolveImport': {
      const [looks, items] = await Promise.all([loadAppearance(), loadEquipment()]);
      return { value: resolveImport(request.record, looks, items) };
    }
    case 'icon': {
      if (!storage) throw new Error('No folder is open');
      const file = request.fileId ? await storage.readFile(request.fileId) : undefined;
      const value: IconResult = file && decodeBlp(file.data);
      return { value, transfer: value ? [value.pixels.buffer] : [] };
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
