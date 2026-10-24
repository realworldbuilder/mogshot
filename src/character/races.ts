import type { Row } from '../db2/wdc';

/*
 * The races a player can create and the classes they can be, as the character creation
 * screen lists them: each race on its faction's side in the game's order, every class in
 * the game's order with the races that can be it.
 */

export type Faction = 'alliance' | 'horde' | 'neutral' | 'unknown';

export interface Race {
  id: number;
  name: string;
  /** The game's file name for the race (`Orc`, `NightElf`, `Scourge`), as the addon API reports it. */
  file: string;
  /** Sexes the race has a model for: 0 = male, 1 = female. */
  sexes: number[];
  /** Which side of the character creation screen the race is on. */
  faction: Faction;
  /** The race's place on that screen; by name when the game data does not say. */
  order: number;
  /** The race's name in the game's interface atlas (`nightelf`, `undead`). */
  key: string;
}

export interface ClassEntry {
  id: number;
  name: string;
  /** The class's name in the game's interface atlas (`warrior`, `deathknight`). */
  key: string;
  /** The races that can be this class. */
  races: number[];
}

/** What ChrRaces says about a race beyond its name, when the build's layout has the columns. */
export interface RaceExtras {
  /** 0 Alliance, 1 Horde, 2 neutral. */
  alliance: unknown;
  order: unknown;
}

const n = (value: unknown): number => Number(value ?? 0);

const FACTIONS: Record<number, Faction> = { 0: 'alliance', 1: 'horde', 2: 'neutral' };

export function factionOf(alliance: unknown): Faction {
  return FACTIONS[Number(alliance)] ?? 'unknown';
}

/**
 * The atlas names a race by its file name in lower case, except these: the Undead, whose file
 * name is Scourge, and the races the atlas calls by one word where the file name has two (the
 * raceicon128-* members of retail 12.1.5; the Haranir's file name is still spelt Harronir there).
 */
const KEY_EXCEPTIONS: Record<string, string> = {
  scourge: 'undead',
  harronir: 'haranir',
  highmountaintauren: 'highmountain',
  lightforgeddraenei: 'lightforged',
  earthendwarf: 'earthen',
  zandalaritroll: 'zandalari',
};

export function raceKey(file: string): string {
  const key = file.toLowerCase();
  return KEY_EXCEPTIONS[key] ?? key;
}

/**
 * The races a player can create, in the game's display order when `extras` gives one, else by
 * name. A race with no model for either sex is left out.
 */
export function playableRaces(
  chrRaces: readonly Row[],
  creatable: ReadonlySet<number>,
  hasModel: (raceId: number, sex: number) => boolean,
  extras?: ReadonlyMap<number, RaceExtras>,
): Race[] {
  const races = chrRaces
    .filter((row) => creatable.has(n(row.ID)))
    .map((row) => {
      const id = n(row.ID);
      const extra = extras?.get(id);
      const file = String(row.ClientFileString ?? '');
      return {
        id,
        name: String(row.Name_lang),
        file,
        sexes: [0, 1].filter((sex) => hasModel(id, sex)),
        faction: extra ? factionOf(extra.alliance) : ('unknown' as Faction),
        order: extra ? n(extra.order) : 0,
        key: raceKey(file),
      };
    })
    .filter((race) => race.sexes.length > 0)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  // Without the game's order, the place in the list is the order.
  if (!extras) races.forEach((race, i) => (race.order = i));
  return races;
}

/**
 * Every class some race can be, in the game's order (by ID: Warrior first, Druid last), each
 * with the races that can be it. `Filename` names the class in the interface atlas; when the
 * build's layout lacks it the name does, without its spaces.
 */
export function classList(chrClasses: readonly Row[], baseInfo: readonly Row[]): ClassEntry[] {
  const racesOfClass = new Map<number, number[]>();
  for (const row of baseInfo) {
    const classId = n(row.ClassID);
    const raceId = n(row.RaceID);
    let races = racesOfClass.get(classId);
    if (!races) racesOfClass.set(classId, (races = []));
    if (!races.includes(raceId)) races.push(raceId);
  }
  return chrClasses
    .filter((row) => racesOfClass.has(n(row.ID)))
    .map((row) => {
      const name = String(row.Name_lang);
      const file = row.Filename === undefined ? name.replace(/\s+/g, '') : String(row.Filename);
      return { id: n(row.ID), name, key: file.toLowerCase(), races: racesOfClass.get(n(row.ID))!.sort((a, b) => a - b) };
    })
    .sort((a, b) => a.id - b.id);
}
