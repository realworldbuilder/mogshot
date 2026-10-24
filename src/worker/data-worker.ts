/// <reference lib="webworker" />
import { buildPlace } from '../world/place';
import { IndexedDbCache } from '../casc/cache';
import { CascStorage, InstallError, listProducts } from '../casc/storage';
import { Appearance } from '../character/appearance';
import { type LoadingScreen, loadLoadingScreens } from '../character/backdrops';
import { Equipment } from '../character/equipment';
import { loadPortraits } from '../character/portraits';
import { Creatures } from '../character/creatures';
import { humanoidLook } from '../character/npc';
import { buildCharacterScene, type CharacterRig } from '../character/scene';
import { type FightSoundChoice, loadFightSounds, Sounds } from '../character/sounds';
import { SpellIcons } from '../character/spell-icons';
import { buildSpellModel, type SpellModel, SpellVisuals } from '../character/spell-visuals';
import { Database } from '../db2/database';
import { Definitions } from '../db2/definitions';
import { decodeBlp, type Image } from '../formats/blp';
import { resolveImport } from '../import/resolve';
import { FileListSource } from '../io/file-list-source';
import type { CharacterResult, CreatureLook, FighterResult, IconResult, ItemIcon, ItemSearchResult, MapSummary, OpenResult, Portraits, Request, Response } from './api';

let storage: CascStorage | undefined;
let database: Database | undefined;
let appearance: Promise<Appearance> | undefined;
let equipment: Promise<Equipment> | undefined;
let screens: Promise<LoadingScreen[]> | undefined;
let portraits: Promise<Portraits> | undefined;
let sounds: Promise<Sounds> | undefined;
let creatures: Promise<Creatures> | undefined;
let spellIcons: Promise<SpellIcons> | undefined;
let spellVisuals: Promise<SpellVisuals> | undefined;
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

/** The creature data (NPC displays), loaded from the database the first time it is needed. */
async function loadCreatures(): Promise<Creatures> {
  if (!database) throw new Error('No folder is open');
  creatures ??= Creatures.load(database);
  try {
    return await creatures;
  } catch (error) {
    creatures = undefined;
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
      screens = undefined;
      portraits = undefined;
      sounds = undefined;
      creatures = undefined;
      spellIcons = undefined;
      spellVisuals = undefined;
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
    case 'fighter': {
      if (!storage) throw new Error('No folder is open');
      const start = performance.now();
      const appearance = await loadAppearance();
      // The item tables are only read once something is worn: items given, or an NPC's own looks.
      const items = request.gear.length > 0 || request.npc !== undefined ? await loadEquipment() : undefined;
      // An NPC: the race, sex, choices, worn looks and painted body its display names, with the request's choices over them.
      let who = { raceId: request.raceId, sex: request.sex, choices: new Map(request.choices) };
      let look: ReturnType<typeof humanoidLook> | undefined;
      if (request.npc !== undefined) {
        const display = (await loadCreatures()).display(request.npc);
        if (!display) throw new Error(`There is no creature display ${request.npc} in this game folder`);
        look = humanoidLook(display, appearance, (fileId) => storage!.files.find(fileId) !== undefined);
        who = { raceId: look.raceId, sex: look.sex, choices: new Map([...look.choices, ...request.choices]) };
      }
      const built = await buildCharacterScene(storage, appearance, items, {
        ...who,
        gear: new Map(request.gear),
        ...(look && { wear: look.wear, bake: look.bake, scale: look.scale }),
        pose: { preset: 'Stand' },
      });
      const packed = await built.pack(request.animations);
      const { scene } = built;
      if (look) scene.problems.push(...look.problems);
      const value: FighterResult = { scene, rig: packed, wielding: built.wielding, raceId: who.raceId, sex: who.sex, ms: performance.now() - start };
      // Nothing of this character is kept here: every buffer moves to the page.
      const buffers = new Set<ArrayBufferLike>(scene.textures.map((texture) => texture.pixels.buffer));
      for (const mesh of scene.meshes) buffers.add(mesh.vertices.buffer).add(mesh.indices.buffer).add(mesh.bones.buffer).add(mesh.transform.buffer);
      buffers.add(packed.body.md20.buffer);
      for (const [, keys] of packed.anims) buffers.add(keys.buffer);
      for (const [, matrix] of packed.boneOffsets) buffers.add(matrix.buffer);
      for (const mesh of packed.meshes) if (mesh.follows === 'attachment') buffers.add(mesh.own.buffer);
      return { value, transfer: [...buffers] as Transferable[] };
    }
    case 'creatureDisplays': {
      const table = await loadCreatures();
      const value: CreatureLook[] = [];
      for (const id of request.ids) {
        const display = table.display(id);
        if (!display) continue;
        const { humanoid } = display;
        value.push({ id, scale: display.scale, ...(humanoid && { humanoid: { raceId: humanoid.raceId, sex: humanoid.sex } }) });
      }
      return { value };
    }
    case 'pose': {
      if (!rig) throw new Error('No character has been built');
      const value = await rig.pose(request.sequence, request.time);
      return { value, transfer: value.meshes.flatMap((mesh) => [mesh.bones.buffer, mesh.transform.buffer]) as Transferable[] };
    }
    case 'sounds': {
      if (!storage || !database) throw new Error('No folder is open');
      sounds ??= Sounds.load(database);
      let table: Sounds;
      try {
        table = await sounds;
      } catch (error) {
        sounds = undefined;
        throw error;
      }
      const choice: FightSoundChoice = { raceId: request.raceId, sex: request.sex };
      if (request.classId !== undefined) choice.classId = request.classId;
      if (request.wielding !== undefined) choice.wielding = request.wielding;
      const subclass = request.mainHand === undefined ? undefined : (await loadEquipment()).weaponSubclass(request.mainHand);
      if (subclass !== undefined) choice.weaponSubclass = subclass;
      const value = await loadFightSounds(storage, table, choice);
      // The archives are read again for the next request: every clip's bytes move to the page.
      const buffers = new Set<ArrayBufferLike>();
      for (const kit of Object.values(value.kits)) for (const clip of kit.clips) buffers.add(clip.bytes.buffer);
      return { value, transfer: [...buffers] as Transferable[] };
    }
    case 'searchItems': {
      const value: ItemSearchResult = (await loadEquipment()).search(request.slot, request.query);
      return { value };
    }
    case 'classList':
      return { value: (await loadAppearance()).classes };
    case 'portraits': {
      if (!storage) throw new Error('No folder is open');
      const files = storage;
      portraits ??= loadAppearance().then((looks) =>
        loadPortraits(database!, (fileId) => files.readFile(fileId).then((file) => file?.data), looks.races, looks.classes),
      );
      let value: Portraits;
      try {
        value = await portraits;
      } catch (error) {
        portraits = undefined;
        throw error;
      }
      // The pictures are copied out: the worker keeps its own for the next request.
      const copy = (images: Record<string, Image>) => Object.fromEntries(Object.entries(images).map(([key, image]) => [key, { ...image, pixels: image.pixels.slice() }]));
      const sent = { races: copy(value.races), classes: copy(value.classes), problems: value.problems };
      return { value: sent, transfer: [...Object.values(sent.races), ...Object.values(sent.classes)].map((image) => image.pixels.buffer) };
    }
    case 'sets':
      return { value: (await loadEquipment()).sets(request.classId) };
    case 'randomOutfit':
      return { value: (await loadEquipment()).randomOutfit(request.minQuality) };
    case 'resolveImport': {
      const [looks, items] = await Promise.all([loadAppearance(), loadEquipment()]);
      return { value: resolveImport(request.record, looks, items) };
    }
    case 'place': {
      if (!database || !storage) throw new Error('No folder is open');
      const maps = await database.table('Map', ['WdtFileDataID']);
      const wdtFileId = Number(maps.rows.find((row) => Number(row.ID) === request.map)?.WdtFileDataID ?? 0);
      if (!wdtFileId) throw new Error(`Map ${request.map} has no outdoor world in this build`);
      const value = await buildPlace(storage, { wdtFileId, x: request.x, y: request.y, z: request.z, facing: request.facing, reach: request.reach });
      const buffers = new Set<ArrayBufferLike>();
      for (const mesh of [...value.meshes, ...value.terrain, ...value.props]) buffers.add(mesh.vertices.buffer).add(mesh.indices.buffer);
      for (const image of [...value.textures, ...value.propTextures, ...value.terrain.map((mesh) => mesh.blend)]) buffers.add(image.pixels.buffer);
      return { value, transfer: [...buffers] as Transferable[] };
    }
    case 'maps': {
      if (!database || !storage) throw new Error('No folder is open');
      const maps = await database.table('Map', ['MapName_lang', 'WdtFileDataID']);
      const files = storage.files;
      const value: MapSummary[] = [];
      for (const row of maps.rows) {
        const wdtFileId = Number(row.WdtFileDataID);
        if (wdtFileId && files.find(wdtFileId)) value.push({ id: Number(row.ID), name: String(row.MapName_lang ?? '') });
      }
      return { value };
    }
    case 'backdrops': {
      if (!database || !storage) throw new Error('No folder is open');
      // Only screens whose picture this install has: a build lists screens for content it does not ship.
      const files = storage.files;
      screens ??= loadLoadingScreens(database).then((list) => list.filter((screen) => files.find(screen.fileId) !== undefined));
      try {
        return { value: await screens };
      } catch (error) {
        screens = undefined;
        throw error;
      }
    }
    case 'icon': {
      if (!storage) throw new Error('No folder is open');
      const file = request.fileId ? await storage.readFile(request.fileId) : undefined;
      const value: IconResult = file && decodeBlp(file.data);
      return { value, transfer: value ? [value.pixels.buffer] : [] };
    }
    case 'file': {
      if (!storage) throw new Error('No folder is open');
      const file = request.fileId ? await storage.readFile(request.fileId) : undefined;
      const value = file ? file.data.slice() : undefined;
      return { value, transfer: value ? [value.buffer] : [] };
    }
    case 'spellIcons': {
      if (!database) throw new Error('No folder is open');
      spellIcons ??= SpellIcons.load(database);
      try {
        return { value: (await spellIcons).find(request.names) };
      } catch (error) {
        spellIcons = undefined;
        throw error;
      }
    }
    case 'spellVisuals': {
      if (!database) throw new Error('No folder is open');
      spellVisuals ??= SpellVisuals.load(database);
      try {
        return { value: (await spellVisuals).find(request.spells) };
      } catch (error) {
        spellVisuals = undefined;
        throw error;
      }
    }
    case 'spellModels': {
      if (!storage) throw new Error('No folder is open');
      const value: SpellModel[] = [];
      for (const fileId of request.fileIds) {
        const model = await buildSpellModel(storage, fileId).catch(() => undefined);
        if (model) value.push(model);
      }
      // Nothing is kept here: every buffer moves to the page.
      const buffers = new Set<ArrayBufferLike>();
      for (const { scene, rig } of value) {
        for (const texture of scene.textures) buffers.add(texture.pixels.buffer);
        for (const mesh of scene.meshes) buffers.add(mesh.vertices.buffer).add(mesh.indices.buffer).add(mesh.bones.buffer).add(mesh.transform.buffer);
        buffers.add(rig.body.md20.buffer);
        for (const [, keys] of rig.anims) buffers.add(keys.buffer);
      }
      return { value, transfer: [...buffers] as Transferable[] };
    }
    case 'itemIcons': {
      const items = await loadEquipment();
      const value: ItemIcon[] = request.ids.map((id) => ({ id, fileId: items.resolveItem(id)?.iconFileId ?? 0 }));
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
