import type { Database } from '../db2/database';
import type { Row } from '../db2/wdc';

/*
 * The icons of spells, by name, the way the spellbook shows them: SpellName gives every spell
 * its name, SpellMisc the file id of its icon (SpellIconFileDataID). Many spells share a name
 * (every rank, every NPC copy of Frostbolt); the one with the lowest id that has an icon is
 * taken, which is the player's own spell in nearly every case.
 */

export interface SpellIcon {
  name: string;
  /** File id of the icon's BLP, or 0 when no spell of that name has one. */
  fileId: number;
  /** The spell chosen, or 0. */
  spellId: number;
}

const n = (value: unknown): number => Number(value ?? 0);

/**
 * For each wanted name, the icon of the lowest-id spell of that name (compared without regard
 * to case) that has an icon. `misc` rows are SpellMisc's, `names` rows SpellName's.
 */
export function chooseSpellIcons(names: readonly Row[], misc: readonly Row[], wanted: readonly string[]): SpellIcon[] {
  const wantedKeys = new Set(wanted.map((name) => name.toLowerCase()));
  // Spell ids by lowercase name, only for the names asked for: SpellName is large.
  const idsByName = new Map<string, number[]>();
  for (const row of names) {
    const key = String(row.Name_lang ?? '').toLowerCase();
    if (!wantedKeys.has(key)) continue;
    let ids = idsByName.get(key);
    if (!ids) idsByName.set(key, (ids = []));
    ids.push(n(row.ID));
  }
  const candidates = new Set([...idsByName.values()].flat());
  const iconBySpell = new Map<number, number>();
  for (const row of misc) {
    const spell = n(row.SpellID);
    if (!candidates.has(spell)) continue;
    const icon = n(row.SpellIconFileDataID);
    // The base difficulty's row wins; any row with an icon beats none.
    if (icon && (!iconBySpell.has(spell) || n(row.DifficultyID) === 0)) iconBySpell.set(spell, icon);
  }
  return wanted.map((name) => {
    const ids = (idsByName.get(name.toLowerCase()) ?? []).sort((a, b) => a - b);
    const spellId = ids.find((id) => iconBySpell.has(id)) ?? 0;
    return { name, fileId: iconBySpell.get(spellId) ?? 0, spellId };
  });
}

/** Spell icons looked up in an open folder's tables; the tables are read once and kept. */
export class SpellIcons {
  private constructor(
    private readonly names: readonly Row[],
    private readonly misc: readonly Row[],
  ) {}

  static async load(database: Database): Promise<SpellIcons> {
    const [names, misc] = await Promise.all([
      database.table('SpellName', ['Name_lang']),
      database.table('SpellMisc', ['SpellID', 'DifficultyID', 'SpellIconFileDataID']),
    ]);
    return new SpellIcons(names.rows, misc.rows);
  }

  find(wanted: readonly string[]): SpellIcon[] {
    return chooseSpellIcons(this.names, this.misc, wanted);
  }
}
