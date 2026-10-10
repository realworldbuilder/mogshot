import type { Appearance, Option, Race } from '../src/character/appearance';
import type { LoadingScreen } from '../src/character/backdrops';
import type { CreatureDisplay, Creatures } from '../src/character/creatures';
import { type ClassInfo, type Equipment, type ItemSummary, type Slot, SLOTS } from '../src/character/equipment';
import type { PoseRequest } from '../src/character/scene';
import type { CachedCreature } from '../src/import/creature-cache';
import { decodeRecord, type ImportedRecord } from '../src/import/record';
import { resolveImport } from '../src/import/resolve';
import { type Backdrop, GRADIENTS, NO_BACKDROP } from '../src/render/backdrop';
import { CLIP_FPS, type ClipFormat, clipSize, evenSize, GIF_FPS } from '../src/render/clip';
import { type Camera, DEFAULT_CAMERA } from '../src/render/renderer';
import { hasTitle, type Title } from '../src/render/title';
import type { Spot } from '../src/world/place';
import type { MapInfo, SeenCreatures } from './session';

/*
 * A picture as someone writes it down: names where the page has menus, numbers where it has
 * sliders. `resolveSpec` turns it into the game's ids, or says which name it could not place.
 */

/** A choice of an appearance option: its name, its place in the list (from 1), or its id. */
export type ChoiceRef = string | number | { id: number };

export interface Spec {
  /** Where the PNG goes, relative to the spec file. A clip's ending picks its kind: .mp4, .gif, or .zip for PNG frames. */
  out?: string;
  /** A character the addon captured (`Rambleon`, `Rambleon-Realm`) or a pasted `MOG…` code: the starting point. */
  character?: string;
  /**
   * An NPC in place of a player character: a creature display id, or the NPC's name where
   * the game knows it (the pets the files list, and NPCs this computer has seen in the
   * game). Drawn as the game draws it, so `race`, `sex` and `character` are left out.
   */
  npc?: number | string;
  race?: string | number;
  sex?: 'male' | 'female' | 0 | 1;
  /** Option name or id -> choice. Options left out keep the character's choice, or the first one. */
  choices?: Record<string, ChoiceRef>;
  /** A class's set of armour with weapons to match; without a name, the class's best. */
  set?: { class: string | number; name?: string };
  /** Slot -> item id or name; null empties the slot. Applied over the character's and the set's items. */
  gear?: Partial<Record<Slot, number | string | null>>;
  /** A curated pose by name, or a moment of an animation (`at` is 0..1 through it). */
  pose?: string | { animation: string; at?: number } | { animationId: number; variation?: number; time?: number };
  /** Angles in degrees. */
  /**
   * A looping clip instead of a picture: one pass of the pose's animation (or the one named),
   * or `seconds` of it going round. 30 frames a second unless said; a GIF is always 25.
   * With `loop`, `seconds` is rounded to whole passes so the end meets the start. `to` is
   * the camera at the end (fields as in `camera`): the view moves there over the clip.
   */
  clip?: true | { animation?: string; seconds?: number; loop?: boolean; fps?: number; to?: Partial<Camera> };
  /**
   * Stand the character in the game world: a map by name or number (Eastern Kingdoms unless
   * said) and the position the game reports there (/script print(UnitPosition("player"))).
   * `z` picks between floors; `facing` is degrees anticlockwise from north; `reach` is how
   * many yards of world are drawn. The place fills the frame, in place of a backdrop.
   * `empty` leaves the character out: the view it would have had, with nobody in it.
   */
  place?: { map?: string | number; x: number; y: number; z?: number; facing?: number; reach?: number; empty?: boolean };
  camera?: Partial<Camera>;
  size?: string | { width: number; height: number; tight?: boolean };
  /**
   * Words over the picture or over every frame of a clip: a title, or a title with a smaller
   * line under it (`sub`), near the top unless `at` says the bottom. A tight crop has no room for one.
   */
  title?: string | { text: string; sub?: string; at?: 'top' | 'bottom' };
  backdrop?:
    | string
    | { colour: string; vignette?: number }
    | { gradient: string | { from: string; to: string }; shape?: 'radial' | 'vertical'; vignette?: number }
    | { screen: string | number; blur?: number; vignette?: number };
}

export interface PictureSize {
  width: number;
  height: number;
  /** Crop to the character. Only without a backdrop, as on the page. */
  tight: boolean;
}

/** The sizes that have names: the page's, for a character and for a backdrop. */
export const SIZES: Record<string, PictureSize> = {
  tight: { width: 2880, height: 3840, tight: true },
  '4k': { width: 3840, height: 2160, tight: false },
  '1080p': { width: 1920, height: 1080, tight: false },
  youtube: { width: 1280, height: 720, tight: false },
  square: { width: 2160, height: 2160, tight: false },
  portrait: { width: 2880, height: 3840, tight: false },
  story: { width: 2160, height: 3840, tight: false },
  reel: { width: 2160, height: 3840, tight: false },
};

/** A spec with every name placed. */
export interface Shot {
  raceId: number;
  sex: number;
  /** The NPC drawn, when the spec names one. */
  npc?: { displayId: number; creatureId?: number; name?: string; title?: string; scale: number };
  choices: Map<number, number>;
  gear: Map<Slot, ItemSummary>;
  /** An NPC's gear by item look (ItemDisplayInfo id), in the slots `gear` leaves empty. */
  wear: Map<Slot, number>;
  /** The file of an NPC's painted body texture. */
  bake?: number;
  /** The pose to build in. */
  pose: PoseRequest;
  /** An animation asked for by name, found once the model is read. */
  animation?: { name: string; at: number };
  /** A clip to film instead of a picture to take. */
  clip?: { format: ClipFormat; animation?: string; seconds?: number; loop: boolean; fps: number; cameraTo?: Camera };
  /** Where in the game world the character stands, if anywhere. */
  place?: Spot;
  /** The place is drawn without the character. */
  empty: boolean;
  camera: Camera;
  size: PictureSize;
  backdrop: Backdrop;
  /** The backdrop is a classic loading screen: a square the game stretches to 4:3. */
  classicScreen: boolean;
  /** Words laid over the picture. */
  title?: Title;
  problems: string[];
  notes: string[];
}

export interface World {
  appearance: Appearance;
  equipment: Equipment;
  classes: ClassInfo[];
  screens: LoadingScreen[];
  records: ImportedRecord[];
  maps: MapInfo[];
  creatures: Creatures;
  seen: SeenCreatures;
  /** Whether a file of the build is on disk. */
  installed: (fileId: number) => boolean;
}

const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The one thing a name means: an exact match, or the only one that contains it. */
export function byName<T>(list: readonly T[], name: string, what: string, nameOf: (item: T) => string | string[]): T {
  const wanted = plain(name);
  const namesOf = (item: T) => [nameOf(item)].flat().map(plain);
  const exact = list.filter((item) => namesOf(item).includes(wanted));
  if (exact.length > 0) return exact[0]!;
  const partial = wanted === '' ? [] : list.filter((item) => namesOf(item).some((n) => n.includes(wanted)));
  if (partial.length === 1) return partial[0]!;
  const show = (items: readonly T[]) => items.slice(0, 12).map((item) => [nameOf(item)].flat()[0]).join(', ');
  if (partial.length > 1) throw new Error(`"${name}" could be more than one ${what}: ${show(partial)}${partial.length > 12 ? ', …' : ''}`);
  throw new Error(`There is no ${what} called "${name}". There is: ${show(list)}${list.length > 12 ? ', …' : ''}`);
}

export function raceOf(appearance: Appearance, ref: string | number): Race {
  if (typeof ref === 'number') {
    const race = appearance.races.find((r) => r.id === ref);
    if (!race) throw new Error(`There is no race number ${ref}`);
    return race;
  }
  return byName(appearance.races, ref, 'race', (r) => [r.name, r.file]);
}

export function sexOf(ref: Spec['sex']): number {
  if (ref === 0 || ref === 'male') return 0;
  if (ref === 1 || ref === 'female') return 1;
  throw new Error(`Sex is "male" or "female", not ${JSON.stringify(ref)}`);
}

export function classOf(classes: readonly ClassInfo[], ref: string | number): ClassInfo {
  if (typeof ref === 'number') {
    const found = classes.find((c) => c.id === ref);
    if (!found) throw new Error(`There is no class number ${ref}`);
    return found;
  }
  return byName(classes, ref, 'class', (c) => c.name);
}

/** The options of a model that the character screen offers, each with the choices a player can make. */
export function offered(options: readonly Option[]): Option[] {
  return options.filter((o) => !o.hidden).map((o) => ({ ...o, choices: o.choices.filter((c) => c.available) }));
}

function choiceOf(option: Option, ref: ChoiceRef): number {
  if (typeof ref === 'object') {
    if (!option.choices.some((c) => c.id === ref.id)) throw new Error(`${option.name} has no choice with id ${ref.id}`);
    return ref.id;
  }
  if (typeof ref === 'number') {
    const choice = option.choices[ref - 1];
    if (!choice) throw new Error(`${option.name} has choices 1 to ${option.choices.length}, not ${ref}`);
    return choice.id;
  }
  return byName(option.choices, ref, `${option.name} choice`, (c) => c.name).id;
}

function itemOf(equipment: Equipment, slot: Slot, ref: number | string): ItemSummary {
  const info = SLOTS.find((s) => s.id === slot);
  if (!info) throw new Error(`There is no slot called "${slot}". The slots are: ${SLOTS.map((s) => s.id).join(', ')}`);
  if (typeof ref === 'number') {
    const item = equipment.resolveItem(ref);
    if (!item) throw new Error(`Item ${ref} has no look in the game data`);
    if (!info.inventoryTypes.includes(item.inventoryType)) throw new Error(`${item.name} (${ref}) does not go in the ${info.name.toLowerCase()} slot`);
    return item;
  }
  const { items } = equipment.search(slot, ref, 200);
  return byName(items.length > 0 ? items : equipment.search(slot, '', 12).items, ref, `${info.name.toLowerCase()} item`, (i) => i.name);
}

/** The display and, where known, the creature a spec's `npc` names. */
function npcOf(world: World, ref: number | string): { display: CreatureDisplay; creature?: CachedCreature; fromCache: boolean } {
  if (typeof ref === 'number') {
    const display = world.creatures.display(ref);
    if (!display) throw new Error(`There is no creature display ${ref} in the game data`);
    return { display, fromCache: false };
  }
  const game: (CachedCreature & { source: 'game' | 'seen' })[] = world.creatures.creatures.map((c) => ({
    id: c.id, name: c.name, title: c.title, displays: c.displays.map((d) => ({ ...d, probability: 1 })), source: 'game',
  }));
  const seen = world.seen.entries.filter((entry) => !game.some((c) => c.id === entry.id)).map((entry) => ({ ...entry, source: 'seen' as const }));
  let creature: (typeof game)[number];
  try {
    creature = byName([...game, ...seen], ref, 'NPC', (c) => c.name);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `${message} Names come from the game files' pets list and from NPCs this computer has seen in the game: stand near the NPC once with the game running, or give its display id.`,
    );
  }
  // The game picks one of a creature's looks by chance; the first is the usual one.
  const look = creature.displays.find((d) => d.probability > 0) ?? creature.displays[0];
  if (!look) throw new Error(`${creature.name} has no display in the game data`);
  const display = world.creatures.display(look.id);
  if (!display) throw new Error(`${creature.name} is drawn with creature display ${look.id}, which is not in the game data`);
  // The server's scale for the creature on top of the game data's scale for the model.
  return { display: { ...display, scale: display.scale * (look.scale || 1) }, creature, fromCache: creature.source === 'seen' };
}

function recordOf(records: readonly ImportedRecord[], ref: string): ImportedRecord {
  if (/^MOG\d;/.test(ref.trim())) {
    const record = decodeRecord(ref);
    if (!record) throw new Error('The character code could not be read');
    return record;
  }
  if (records.length === 0) throw new Error(`No character called "${ref}": the Mogshot addon has saved none in this game folder`);
  return byName(records, ref, 'saved character', (r) => [r.key, r.name]);
}

function backdropOf(ref: Spec['backdrop'], screens: readonly LoadingScreen[]): { backdrop: Backdrop; classicScreen: boolean } {
  const flat = (backdrop: Backdrop) => ({ backdrop, classicScreen: false });
  const gradient = (name: string | { from: string; to: string }, shape: 'radial' | 'vertical' = 'radial', vignette = 0) => {
    const { from, to } = typeof name === 'string' ? byName(GRADIENTS, name, 'gradient', (g) => g.name) : name;
    return flat({ kind: 'gradient', from, to, shape, vignette });
  };
  if (ref === undefined || ref === 'none') return flat(NO_BACKDROP);
  if (typeof ref === 'string') return ref.startsWith('#') ? flat({ kind: 'colour', colour: ref, vignette: 0 }) : gradient(ref);
  if ('colour' in ref) return flat({ kind: 'colour', colour: ref.colour, vignette: ref.vignette ?? 0 });
  if ('gradient' in ref) return gradient(ref.gradient, ref.shape, ref.vignette);
  if ('screen' in ref) {
    const wanted = ref.screen;
    const screen = typeof wanted === 'number' ? screens.find((s) => s.fileId === wanted) : byName(screens, wanted, 'loading screen', (s) => s.name);
    if (!screen) throw new Error(`This install has no loading screen with file ${wanted}`);
    // The page's defaults: sharp, with the edges darkened a little.
    return { backdrop: { kind: 'screen', fileId: screen.fileId, blur: ref.blur ?? 0, vignette: ref.vignette ?? 0.4 }, classicScreen: !screen.wide };
  }
  throw new Error(`A backdrop is "none", a colour, a gradient or a screen, not ${JSON.stringify(ref)}`);
}

function sizeOf(ref: Spec['size']): PictureSize {
  if (ref === undefined) return SIZES.tight!;
  if (typeof ref === 'string') {
    const size = SIZES[ref.toLowerCase()];
    if (!size) throw new Error(`There is no size called "${ref}". The sizes are: ${Object.keys(SIZES).join(', ')}`);
    return size;
  }
  const { width, height } = ref;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new Error('A size needs a whole width and height in pixels');
  return { width, height, tight: ref.tight ?? false };
}

const CLIP_ENDINGS: Record<string, ClipFormat> = { mp4: 'mp4', gif: 'gif', zip: 'frames' };

/** The kind of clip a file name asks for, or undefined for a picture. */
export function clipFormatOf(out: string | undefined): ClipFormat | undefined {
  return CLIP_ENDINGS[out?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? ''];
}

function clipOf(spec: Spec): Shot['clip'] {
  const format = clipFormatOf(spec.out);
  if (!spec.clip) {
    if (format) throw new Error(`"${spec.out}" is a clip's file name; add "clip": true to film one`);
    return undefined;
  }
  if (spec.out !== undefined && !format) throw new Error(`A clip is saved as .mp4, .gif or .zip (PNG frames), not "${spec.out}"`);
  const { animation, seconds, loop, fps, to } = spec.clip === true ? ({} as Exclude<Spec['clip'], true | undefined>) : spec.clip;
  if (seconds !== undefined && !(seconds > 0 && seconds <= 60)) throw new Error('A clip is between 0 and 60 seconds long');
  if (fps !== undefined && !(fps >= 1 && fps <= 60)) throw new Error('A clip has 1 to 60 frames a second');
  const kind = format ?? 'mp4';
  if (loop && seconds === undefined) throw new Error('"loop" rounds "seconds" to whole passes of the animation; give the seconds too');
  return { format: kind, animation, seconds, loop: loop === true, fps: kind === 'gif' ? GIF_FPS : (fps ?? CLIP_FPS), cameraTo: to && cameraOf({ ...spec.camera, ...to }) };
}

/** The words to lay over the picture, if any. */
export function titleOf(spec: Spec['title']): Title | undefined {
  if (spec === undefined) return undefined;
  const { text, sub, at = 'top' } = typeof spec === 'string' ? { text: spec } : spec;
  if (at !== 'top' && at !== 'bottom') throw new Error(`A title is at the "top" or "bottom", not "${String(at)}"`);
  const title: Title = { text: String(text ?? ''), ...(sub !== undefined && { sub: String(sub) }), at };
  if (!hasTitle(title)) throw new Error('The title has no words');
  return title;
}

/** A clip's size: a square unless said; a named size keeps its shape at video size; numbers are used as given. */
function clipSizeOf(ref: Spec['size'], format: ClipFormat): PictureSize {
  const asked = sizeOf(ref ?? 'square');
  const size = typeof ref === 'object' ? evenSize(asked.width, asked.height) : clipSize(asked, format === 'gif');
  return { ...size, tight: false };
}

function placeOf(ref: Spec['place'], maps: readonly MapInfo[]): Spot | undefined {
  if (!ref) return undefined;
  if (![ref.x, ref.y].every(Number.isFinite)) throw new Error('A place needs the x and y the game reports for the spot');
  const map =
    typeof ref.map === 'number' ? maps.find((m) => m.id === ref.map) : byName(maps, ref.map ?? 'Eastern Kingdoms', 'map', (m) => [m.name, m.directory]);
  if (!map) throw new Error(`There is no map number ${ref.map} with a world on disk`);
  const reach = ref.reach ?? 300;
  if (!(reach >= 20 && reach <= 1500)) throw new Error('A place reaches 20 to 1500 yards');
  return { wdtFileId: map.wdtFileId, x: ref.x, y: ref.y, z: ref.z, facing: ((ref.facing ?? 0) * Math.PI) / 180, reach };
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

function cameraOf(ref: Spec['camera']): Camera {
  return {
    yaw: ref?.yaw === undefined ? DEFAULT_CAMERA.yaw : radians(ref.yaw),
    pitch: ref?.pitch === undefined ? DEFAULT_CAMERA.pitch : radians(ref.pitch),
    fov: ref?.fov === undefined ? DEFAULT_CAMERA.fov : radians(ref.fov),
    zoom: ref?.zoom ?? DEFAULT_CAMERA.zoom,
    panX: ref?.panX ?? DEFAULT_CAMERA.panX,
    panY: ref?.panY ?? DEFAULT_CAMERA.panY,
  };
}

export function resolveSpec(spec: Spec, world: World): Shot {
  const { appearance, equipment } = world;
  const problems: string[] = [];
  const notes: string[] = [];
  const choices = new Map<number, number>();
  const gear = new Map<Slot, ItemSummary>();
  const wear = new Map<Slot, number>();

  let raceId: number | undefined;
  let sex: number | undefined;
  let npc: Shot['npc'];
  let bake: number | undefined;
  /** The options a spec's `choices` may name: what the character screen offers, or for an NPC everything the model has. */
  let optionsOf = (chrModelId: number) => offered(appearance.options(chrModelId));
  if (spec.npc !== undefined) {
    if (spec.race !== undefined || spec.sex !== undefined || spec.character !== undefined) {
      throw new Error('An NPC is drawn as the game draws it; leave out "race", "sex" and "character"');
    }
    const { display, creature, fromCache } = npcOf(world, spec.npc);
    const name = creature?.name ?? `Creature display ${display.id}`;
    npc = { displayId: display.id, creatureId: creature?.id, name: creature?.name, title: creature?.title || undefined, scale: display.scale };
    if (fromCache) notes.push(...world.seen.notes);
    const { humanoid } = display;
    if (!humanoid) throw new Error(`${name} is not built on a player model, which Mogshot cannot draw yet`);
    raceId = humanoid.raceId;
    sex = humanoid.sex;
    const model = appearance.model(raceId, sex);
    if (!model) throw new Error(`${name} is drawn as race ${raceId}, ${sex === 1 ? 'female' : 'male'}, which this build has no player model for`);
    if (display.modelFileId !== model.fileId) {
      problems.push(`The game draws ${name} with model file ${display.modelFileId}, not the player model (file ${model.fileId}) drawn here`);
    }
    for (const [option, choice] of humanoid.choices) choices.set(option, choice);
    for (const [slot, displayId] of humanoid.wear) wear.set(slot, displayId);
    optionsOf = (chrModelId) => appearance.options(chrModelId);
    if (spec.choices) notes.push('Skin and face choices paint the body texture, which an NPC\'s painted body (the bake) replaces');
    // The bake made for the model's texture size, if it is on disk; else the other one.
    const hd = (appearance.skinSize(model)?.width ?? 0) >= 2048;
    const [wanted, other] = hd ? [humanoid.hdBakeFileId, humanoid.bakeFileId] : [humanoid.bakeFileId, humanoid.hdBakeFileId];
    if (wanted && world.installed(wanted)) bake = wanted;
    else if (other && world.installed(other)) {
      bake = other;
      problems.push(`The ${hd ? 'high-res' : 'standard'} painted body of ${name} (file ${wanted || 'none listed'}) is not on disk, so the ${hd ? 'standard' : 'high-res'} one is drawn`);
    } else if (wanted || other) problems.push(`No painted body of ${name} is on disk (files ${[wanted, other].filter(Boolean).join(', ')}); the skin is drawn from the choices instead`);
  }
  if (spec.character !== undefined) {
    const imported = resolveImport(recordOf(world.records, spec.character), appearance, equipment);
    raceId = imported.raceId;
    sex = imported.sex;
    for (const [option, choice] of imported.choices) choices.set(option, choice);
    for (const [slot, item] of imported.gear) gear.set(slot, item);
    problems.push(...imported.problems);
    notes.push(...imported.notes);
  }
  if (spec.race !== undefined) raceId = raceOf(appearance, spec.race).id;
  if (spec.sex !== undefined) sex = sexOf(spec.sex);
  // An empty place still needs a figure to frame the camera on; any will do.
  if (raceId === undefined && spec.place?.empty) raceId = appearance.races[0]?.id;
  if (raceId === undefined) throw new Error('The spec names no race, no character and no npc');
  // An NPC can be built on a race no player can be; it has a number and no name.
  const race = npc ? appearance.races.find((r) => r.id === raceId) : raceOf(appearance, raceId);
  const raceName = race?.name ?? `race ${raceId}`;
  sex ??= race?.sexes[0] ?? 0;
  const model = appearance.model(raceId, sex);
  if (!model) throw new Error(`${raceName} has no ${sex === 1 ? 'female' : 'male'} model in this build`);

  const options = optionsOf(model.chrModelId);
  for (const [name, ref] of Object.entries(spec.choices ?? {})) {
    const option = /^\d+$/.test(name) ? options.find((o) => o.id === Number(name)) : byName(options, name, 'appearance option', (o) => o.name);
    if (!option) throw new Error(`${raceName} has no appearance option ${name}`);
    choices.set(option.id, choiceOf(option, ref));
  }

  if (spec.set) {
    const info = classOf(world.classes, spec.set.class);
    const sets = equipment.sets(info.id);
    if (sets.length === 0) throw new Error(`The game data has no sets for ${info.name}`);
    const set = spec.set.name === undefined ? sets[0]! : byName(sets, spec.set.name, `${info.name} set`, (s) => s.name);
    for (const [slot, item] of [...set.pieces, ...set.weapons]) {
      gear.set(slot, item);
      wear.delete(slot);
    }
  }
  for (const [slot, ref] of Object.entries(spec.gear ?? {}) as [Slot, number | string | null][]) {
    if (ref === null) gear.delete(slot);
    else gear.set(slot, itemOf(equipment, slot, ref));
    wear.delete(slot);
  }

  let pose: PoseRequest = { preset: 'Stand' };
  let animation: Shot['animation'];
  if (typeof spec.pose === 'string') pose = { preset: spec.pose };
  else if (spec.pose && 'animation' in spec.pose) animation = { name: spec.pose.animation, at: spec.pose.at ?? 0 };
  else if (spec.pose) pose = { animationId: spec.pose.animationId, variation: spec.pose.variation ?? 0, time: spec.pose.time ?? 0 };

  const clip = clipOf(spec);
  const size = clip ? clipSizeOf(spec.size, clip.format) : spec.place ? { ...sizeOf(spec.size ?? '1080p'), tight: false } : sizeOf(spec.size);
  const backdrop = backdropOf(spec.backdrop, world.screens);
  let title = titleOf(spec.title);
  // As on the page: a tight crop is only taken of a character with nothing behind it.
  if (title && size.tight && backdrop.backdrop.kind === 'none') {
    title = undefined;
    problems.push('A tight crop has no room for a title, so it was left off; give a "size" or a "backdrop"');
  }

  return {
    raceId,
    sex,
    npc,
    choices,
    gear,
    wear,
    bake,
    pose,
    animation,
    clip,
    place: placeOf(spec.place, world.maps),
    empty: spec.place?.empty === true,
    camera: cameraOf(spec.camera),
    size,
    ...backdrop,
    title,
    problems,
    notes,
  };
}
