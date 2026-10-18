import type { Database } from '../db2/database';
import { type Equipment, type ItemSummary, type Slot, SLOTS } from './equipment';

/*
 * Retail's transmog sets: the named outfits of the game's Appearances tab (raid tiers in each
 * difficulty's colour, PvP seasons, heritage armour, dungeon and Trading Post sets). Each set
 * is a list of appearance sources (ItemModifiedAppearance ids), which is an item in a look.
 * Classic builds have the tables too, mostly empty.
 */

export const EXPANSIONS = [
  'Classic', 'The Burning Crusade', 'Wrath of the Lich King', 'Cataclysm', 'Mists of Pandaria', 'Warlords of Draenor',
  'Legion', 'Battle for Azeroth', 'Shadowlands', 'Dragonflight', 'The War Within', 'Midnight', 'The Last Titan',
];

export type SetKind = 'raid' | 'pvp' | 'heritage' | 'dungeon' | 'other';

export interface TransmogPiece {
  slot: Slot;
  /** The appearance source: the item, and the look it is worn in. */
  sourceId: number;
  item: ItemSummary;
  displayId: number;
}

export interface TransmogSetInfo {
  id: number;
  name: string;
  /** The variant's label: "Mythic", "Heroic", "Raid Finder", "Gladiator" ... or empty for a set with one look. */
  label: string;
  /** The classes it is for, as class ids; empty for any class. */
  classes: number[];
  expansion: string;
  expansionId: number;
  kind: SetKind;
  /** The set whose variant this is (the Normal version of a Mythic set), or 0. */
  parentId: number;
  /** The base set and its variants share a group. */
  groupId: number;
  /** Patch it came in (as 110002 for 11.0.2), when the build says. */
  patch: number;
  pieces: TransmogPiece[];
}

const n = (value: unknown): number => Number(value ?? 0);

/** Names and labels that say what a set is; anything else that names a raid tier's difficulty is a raid set. */
const PVP = /gladiator|combatant|aspirant|elite|warfront|pvp|vindicator|challenger|duelist|rival|marshal|warlord|general|vanguard/i;
const RAID_LABELS = /raid finder|normal|heroic|mythic|tier/i;

function kindOf(name: string, label: string): SetKind {
  if (/heritage/i.test(name) || /heritage/i.test(label)) return 'heritage';
  if (PVP.test(label) || PVP.test(name)) return 'pvp';
  if (RAID_LABELS.test(label)) return 'raid';
  if (/dungeon|timewalking|mythic\+|keystone/i.test(label)) return 'dungeon';
  return 'other';
}

/** Playable classes: Warrior (1) to Evoker (13). */
const LAST_CLASS = 13;

/** The classes in a mask; none when it is every class (or none), which means any. */
function classesOf(mask: number): number[] {
  const ids: number[] = [];
  for (let id = 1; id <= LAST_CLASS; id++) if (mask & (1 << (id - 1))) ids.push(id);
  return ids.length === LAST_CLASS ? [] : ids;
}

export class TransmogSets {
  private constructor(readonly sets: TransmogSetInfo[]) {}

  static async load(database: Database, equipment: Equipment): Promise<TransmogSets> {
    const [sets, items, descriptions] = await Promise.all([
      // Every column: the patch a set came in is only in newer builds' layouts.
      database.table('TransmogSet'),
      database.table('TransmogSetItem', ['TransmogSetID', 'ItemModifiedAppearanceID', 'Flags']),
      database.table('ItemNameDescription', ['Description_lang']).catch(() => undefined),
    ]);
    const labels = new Map((descriptions?.rows ?? []).map((row) => [n(row.ID), String(row.Description_lang ?? '')]));
    const sourcesOf = new Map<number, { sourceId: number; primary: boolean }[]>();
    for (const row of items.rows) {
      const set = n(row.TransmogSetID);
      let list = sourcesOf.get(set);
      if (!list) sourcesOf.set(set, (list = []));
      // Flag 1 marks the set's own piece; the others are items that share its look.
      list.push({ sourceId: n(row.ItemModifiedAppearanceID), primary: (n(row.Flags) & 1) !== 0 });
    }
    const list: TransmogSetInfo[] = [];
    for (const row of sets.rows) {
      const id = n(row.ID);
      const name = String(row.Name_lang ?? '').trim();
      // Placeholders the developers left in ([DNT], [PH]) are not outfits.
      if (!name || name.startsWith('[')) continue;
      // Pieces by slot, the set's own pieces first, then the first source for a slot (a set lists items that share a look).
      const pieces: TransmogPiece[] = [];
      const taken = new Set<Slot>();
      const sources = [...(sourcesOf.get(id) ?? [])].sort((a, b) => Number(b.primary) - Number(a.primary));
      for (const { sourceId } of sources) {
        const source = equipment.source(sourceId);
        if (!source || source.displayId === 0) continue;
        const item = equipment.resolveItem(source.itemId);
        if (!item) continue;
        const fits = SLOTS.filter((s) => s.inventoryTypes.includes(item.inventoryType)).map((s) => s.id);
        const slot = fits.find((s) => !taken.has(s));
        if (!slot) continue;
        taken.add(slot);
        pieces.push({ slot, sourceId, item, displayId: source.displayId });
      }
      if (pieces.length === 0) continue;
      const label = labels.get(n(row.ItemNameDescriptionID)) ?? '';
      const expansionId = n(row.ExpansionID);
      list.push({
        id,
        name,
        label,
        classes: classesOf(n(row.ClassMask)),
        expansion: EXPANSIONS[expansionId] ?? `Expansion ${expansionId}`,
        expansionId,
        kind: kindOf(name, label),
        parentId: n(row.ParentTransmogSetID),
        groupId: n(row.TransmogSetGroupID),
        patch: n(row.PatchIntroduced),
        pieces,
      });
    }
    return new TransmogSets(list);
  }

  get(id: number): TransmogSetInfo | undefined {
    return this.sets.find((set) => set.id === id);
  }

  /** The variants of a set (its difficulties or seasons), the set itself among them, in the game's order. */
  variants(id: number): TransmogSetInfo[] {
    const set = this.get(id);
    if (!set) return [];
    const root = set.parentId || set.id;
    return this.sets.filter((s) => s.id === root || s.parentId === root).sort((a, b) => a.id - b.id);
  }

  /**
   * Sets whose name (or label) has every word of the query, filtered. A set for no class in
   * particular passes any class filter.
   */
  search(query: string, filter: { classId?: number; kind?: SetKind; expansionId?: number; label?: string } = {}, limit = 100): { sets: TransmogSetInfo[]; total: number } {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = this.sets.filter((set) => {
      if (filter.classId !== undefined && set.classes.length > 0 && !set.classes.includes(filter.classId)) return false;
      if (filter.kind !== undefined && set.kind !== filter.kind) return false;
      if (filter.expansionId !== undefined && set.expansionId !== filter.expansionId) return false;
      if (filter.label !== undefined && set.label.toLowerCase() !== filter.label.toLowerCase()) return false;
      const text = `${set.name} ${set.label}`.toLowerCase();
      return words.every((word) => text.includes(word)) || String(set.id) === query.trim();
    });
    const whole = words.join(' ');
    found.sort(
      (a, b) =>
        Number(!a.name.toLowerCase().startsWith(whole)) - Number(!b.name.toLowerCase().startsWith(whole)) ||
        // Asked for a class: its own sets before the ones any class can wear.
        (filter.classId !== undefined ? Number(a.classes.length === 0) - Number(b.classes.length === 0) : 0) ||
        b.expansionId - a.expansionId ||
        a.name.localeCompare(b.name) ||
        a.id - b.id,
    );
    return { sets: found.slice(0, limit), total: found.length };
  }
}
