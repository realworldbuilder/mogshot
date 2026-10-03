import type { Appearance } from '../character/appearance';
import { type Equipment, type ItemSummary, type Slot, SLOTS } from '../character/equipment';
import type { ImportedRecord } from './record';

/*
 * Turn a record the addon captured into something the page can draw: a race and sex the
 * game data has, the appearance choices that apply to them, and the worn items placed in
 * Mogshot's slots. Whatever cannot be placed is said in words, not dropped silently.
 */

export interface ImportResult {
  raceId: number;
  sex: number;
  classId?: number;
  choices: [number, number][];
  gear: [Slot, ItemSummary][];
  /** How many of the record's appearance choices apply; undefined when it had none. */
  choicesApplied?: { applied: number; of: number };
  /** Items found out of items captured. */
  itemsFound: { found: number; of: number };
  problems: string[];
}

const CLASS_HUNTER = 3;

export function resolveImport(record: ImportedRecord, appearance: Appearance, equipment: Equipment): ImportResult {
  const problems: string[] = [];

  const race =
    appearance.races.find((r) => r.id === record.raceId) ??
    appearance.races.find((r) => r.file.toLowerCase() === record.race.toLowerCase());
  if (!race) throw new Error(`The game data has no race called ${record.race || `number ${record.raceId}`} that a player can create`);
  let sex = record.sex;
  if (!race.sexes.includes(sex)) {
    sex = race.sexes[0] ?? 0;
    problems.push(`${race.name} has no ${record.sex === 1 ? 'female' : 'male'} model in this build`);
  }

  // Appearance choices that belong to this race and sex.
  const choices: [number, number][] = [];
  const model = appearance.model(race.id, sex);
  const options = model ? appearance.options(model.chrModelId) : [];
  for (const [option, choice] of record.choices) {
    // The short code gives only the choice (option 0): a choice belongs to one option.
    const owner = options.find((o) => (option === 0 || o.id === option) && o.choices.some((c) => c.id === choice));
    if (owner) choices.push([owner.id, choice]);
  }
  const choicesApplied = record.choices.length > 0 ? { applied: choices.length, of: record.choices.length } : undefined;
  if (choicesApplied && choicesApplied.applied < choicesApplied.of) {
    problems.push(`${choicesApplied.applied} of ${choicesApplied.of} captured appearance choices fit ${race.name} ${sex === 1 ? 'female' : 'male'}`);
  }

  // Gear by slot. A hunter is pictured with the bow; anyone else gets the bow only if a hand is free.
  const gear: [Slot, ItemSummary][] = [];
  const captured = Object.entries(record.gear).filter(([, id]) => id) as [keyof ImportedRecord['gear'], number][];
  let found = 0;
  const lookup = (slot: string, id: number): ItemSummary | undefined => {
    const item = equipment.resolveItem(id);
    const told = record.items?.[id];
    if (!item) {
      problems.push(`${told ? told.name : `Item ${id}`} (${slot}) has no look in the game data`);
      return undefined;
    }
    found++;
    // The files have no name for many items; the addon passes along what the game called it.
    return item.id === id && item.name === `Item ${id}` && told ? { ...item, name: told.name, quality: told.quality } : item;
  };
  const taken = new Set<Slot>();
  const place = (slot: Slot, item: ItemSummary) => {
    const info = SLOTS.find((s) => s.id === slot)!;
    if (!info.inventoryTypes.includes(item.inventoryType)) {
      problems.push(`${item.name} does not go in the ${info.name.toLowerCase()} slot`);
      return;
    }
    taken.add(slot);
    gear.push([slot, item]);
  };
  const ranged = record.gear.ranged ? lookup('ranged', record.gear.ranged) : undefined;
  const hunter = record.classId === CLASS_HUNTER;
  for (const [slot, id] of captured) {
    if (slot === 'ranged') continue;
    const item = lookup(slot, id);
    if (!item) continue;
    if (slot === 'mainHand' && ranged && hunter) {
      problems.push(`${item.name} is left out: a hunter is pictured with the bow`);
      continue;
    }
    place(slot, item);
  }
  if (ranged) {
    if (!taken.has('mainHand')) place('mainHand', ranged);
    else problems.push(`${ranged.name} is left out: both hands are full`);
  }

  return {
    raceId: race.id,
    sex,
    classId: record.classId,
    choices,
    gear,
    choicesApplied,
    itemsFound: { found, of: captured.length },
    problems,
  };
}
