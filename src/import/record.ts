import type { Slot } from '../character/equipment';
import { at, type LuaValue, readSavedVariables } from './lua';

/*
 * A character as the Mogshot addon captures it: who they are and what they wear, as the
 * game's own ids. The same record travels two ways: in the addon's SavedVariables file
 * (read from the game folder) and as a short code the player can copy and paste.
 */

/** The slots the addon captures: Mogshot's visible slots plus Classic's ranged slot. */
export type ImportSlot = Slot | 'ranged';

export const IMPORT_SLOTS: ImportSlot[] = [
  'head', 'shoulder', 'back', 'chest', 'shirt', 'tabard', 'wrist', 'hands', 'waist', 'legs', 'feet',
  'mainHand', 'offHand', 'ranged',
];

export interface ImportedRecord {
  /** `Name-Realm`. */
  key: string;
  name: string;
  realm: string;
  /** The race's file name in the game data (`Orc`, `NightElf`, `Scourge`). */
  race: string;
  raceId?: number;
  /** 0 = male, 1 = female. */
  sex: number;
  classId?: number;
  /** The class's file name (`SHAMAN`). */
  className?: string;
  /** Item ids by slot. */
  gear: Partial<Record<ImportSlot, number>>;
  /** Appearance choices as the game numbers them: option id and choice id. */
  choices: [number, number][];
  /**
   * What the game called each worn item, and its quality, by item id. The game files have
   * no name for many items (the server supplies them), so the addon passes them along.
   */
  items?: Record<number, { name: string; quality: number }>;
  /** When the addon captured the record, as a Unix time in seconds, or 0 if unknown. */
  captured: number;
}

const CODE_TAG = 'MOG1';

function num(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function splitKey(key: string): { name: string; realm: string } {
  const dash = key.indexOf('-');
  return dash < 0 ? { name: key, realm: '' } : { name: key.slice(0, dash), realm: key.slice(dash + 1) };
}

/** The record as a code the player can paste. Fields are `;`-separated; no `|`, which the game eats. */
export function encodeRecord(record: ImportedRecord): string {
  const gear = IMPORT_SLOTS.filter((slot) => record.gear[slot]).map((slot) => `${slot}:${record.gear[slot]}`);
  const choices = record.choices.map(([option, choice]) => `${option}:${choice}`);
  // Names are percent-encoded, so no separator can appear in one.
  const items = Object.entries(record.items ?? {}).map(([id, item]) => `${id}:${item.quality}:${encodeURIComponent(item.name)}`);
  return [
    CODE_TAG,
    record.key,
    record.race,
    record.raceId ?? '',
    record.sex,
    record.classId ?? '',
    record.className ?? '',
    record.captured || '',
    gear.join(','),
    choices.join(','),
    ...(items.length > 0 ? [items.join(',')] : []),
  ].join(';');
}

/** A record from a pasted code, or undefined if the text is not one. */
export function decodeRecord(text: string): ImportedRecord | undefined {
  const fields = text.trim().split(';');
  if (fields[0] !== CODE_TAG || fields.length < 10) return undefined;
  const [, key = '', race = '', raceId, sex, classId, className, captured, gearText = '', choicesText = '', itemsText = ''] = fields;
  const gear: ImportedRecord['gear'] = {};
  for (const pair of gearText.split(',').filter(Boolean)) {
    const [slot, id] = pair.split(':');
    const itemId = num(id);
    if (IMPORT_SLOTS.includes(slot as ImportSlot) && itemId) gear[slot as ImportSlot] = itemId;
  }
  const choices: [number, number][] = [];
  for (const pair of choicesText.split(',').filter(Boolean)) {
    const [option, choice] = pair.split(':').map(num);
    if (option && choice) choices.push([option, choice]);
  }
  const items: NonNullable<ImportedRecord['items']> = {};
  for (const entry of itemsText.split(',').filter(Boolean)) {
    const [id, quality, name = ''] = entry.split(':');
    const itemId = num(id);
    if (!itemId || name === '') continue;
    try {
      items[itemId] = { name: decodeURIComponent(name), quality: num(quality) ?? 1 };
    } catch {
      // A name that does not decode is left out; the item keeps the name the files give it.
    }
  }
  const sexNumber = num(sex);
  if (!key || !race || (sexNumber !== 0 && sexNumber !== 1)) return undefined;
  return {
    key,
    ...splitKey(key),
    race,
    raceId: num(raceId),
    sex: sexNumber,
    classId: num(classId),
    className: className || undefined,
    gear,
    choices,
    captured: num(captured) ?? 0,
    ...(Object.keys(items).length > 0 ? { items } : {}),
  };
}

/** The version of the addon's record this page understands. */
const RECORD_VERSION = 1;

function recordFromLua(key: string, value: LuaValue): ImportedRecord | undefined {
  if (!(value instanceof Map) || num(value.get('v')) !== RECORD_VERSION) return undefined;
  const race = value.get('race');
  const unitSex = num(value.get('sex'));
  // UnitSex: 2 is male, 3 is female, 1 is unknown.
  if (typeof race !== 'string' || race === '' || (unitSex !== 2 && unitSex !== 3)) return undefined;
  const gear: ImportedRecord['gear'] = {};
  for (const slot of IMPORT_SLOTS) {
    const id = num(at(value, 'gear', slot));
    if (id) gear[slot] = id;
  }
  const choices: [number, number][] = [];
  const chosen = value.get('choices');
  if (chosen instanceof Map) {
    for (const [option, choice] of chosen) {
      const o = num(option);
      const c = num(choice);
      if (o && c) choices.push([o, c]);
    }
  }
  choices.sort((a, b) => a[0] - b[0]);
  const items: NonNullable<ImportedRecord['items']> = {};
  const named = value.get('items');
  if (named instanceof Map) {
    for (const [id, item] of named) {
      const itemId = num(id);
      const name = at(item, 'name');
      if (itemId && typeof name === 'string' && name !== '') items[itemId] = { name, quality: num(at(item, 'quality')) ?? 1 };
    }
  }
  const className = value.get('class');
  return {
    key,
    ...splitKey(key),
    race,
    raceId: num(value.get('raceId')),
    sex: unitSex - 2,
    classId: num(value.get('classId')),
    className: typeof className === 'string' && className !== '' ? className : undefined,
    gear,
    choices,
    captured: num(value.get('t')) ?? 0,
    ...(Object.keys(items).length > 0 ? { items } : {}),
  };
}

/** Every character in a Mogshot SavedVariables file. Entries the page does not understand are left out. */
export function recordsFromSavedVariables(text: string): ImportedRecord[] {
  const db = readSavedVariables(text).get('MogshotDB');
  if (!(db instanceof Map)) return [];
  const records: ImportedRecord[] = [];
  for (const [key, value] of db) {
    if (typeof key !== 'string') continue;
    const record = recordFromLua(key, value);
    if (record) records.push(record);
  }
  return records;
}

/** One record per character across several files (several accounts), the newest capture winning. */
export function mergeRecords(lists: ImportedRecord[][]): ImportedRecord[] {
  const byKey = new Map<string, ImportedRecord>();
  for (const list of lists) {
    for (const record of list) {
      const have = byKey.get(record.key);
      if (!have || record.captured >= have.captured) byKey.set(record.key, record);
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** How long ago a capture was, in words. */
export function capturedAgo(captured: number, now = Date.now()): string {
  if (!captured) return 'at an unknown time';
  const seconds = Math.max(0, now / 1000 - captured);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 36) return `${Math.round(hours)} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
