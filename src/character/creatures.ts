import type { Database } from '../db2/database';
import type { Row } from '../db2/wdc';
import type { Slot } from './equipment';

/*
 * The game's creature data: which model and textures a creature display uses, and for a
 * humanoid NPC (a display with an "extra" row) the player race and sex it is built on, the
 * appearance choices it makes, the item looks it wears and the pre-painted body texture
 * (the bake) the game draws it with.
 *
 * The table relationships follow wow.export (MIT, Kruithne and Marlamin) and wowdev.wiki.
 */

/**
 * The slot each NPCModelItemSlotDisplayInfo.ItemSlot number means. 0 (head), 2 (shirt),
 * 5 (legs) and 8 (hands) are verified by Tyrande Whisperwind's rows in build 1.60.1.70205;
 * the rest follow wowdev.wiki's NPC item slot order and are unverified until an NPC that
 * uses them is drawn.
 */
export const NPC_SLOTS: Slot[] = ['head', 'shoulder', 'shirt', 'chest', 'waist', 'legs', 'feet', 'wrist', 'hands', 'tabard', 'back'];

export interface HumanoidDisplay {
  /** The CreatureDisplayInfoExtra row. */
  extraId: number;
  /** The player race and sex whose model and options the NPC is built on. */
  raceId: number;
  sex: number;
  /** Option id -> choice id, as CreatureDisplayInfoOption gives them. */
  choices: Map<number, number>;
  /** Slot -> ItemDisplayInfo id (not an item id). */
  wear: Map<Slot, number>;
  /** The bake: a full body texture with the skin, face and worn cloth already painted. 0 when there is none. */
  bakeFileId: number;
  hdBakeFileId: number;
}

export interface CreatureDisplay {
  id: number;
  /** File id of the model's .m2. */
  modelFileId: number;
  /** The game's scale for the model; 1 for most. */
  scale: number;
  /** Texture files for the model's creature skin slots (M2 texture types 11, 12 and 13). */
  textures: number[];
  /** Set for an NPC built on a player model. */
  humanoid?: HumanoidDisplay;
}

/** A creature the game files name: in a classic client, only the pets and a few others. */
export interface CreatureInfo {
  id: number;
  name: string;
  title: string;
  /** The looks the creature can have, in the table's order, with the game's scale for each. */
  displays: { id: number; scale: number }[];
}

const n = (value: unknown): number => Number(value ?? 0);
const list = (value: unknown): number[] => ((value as number[] | undefined) ?? []).map(n);

export class Creatures {
  private constructor(
    private readonly displays: Map<number, CreatureDisplay>,
    /** Every creature the game files name, in id order. */
    readonly creatures: CreatureInfo[],
  ) {}

  static async load(database: Database): Promise<Creatures> {
    const [displayRows, modelRows, extraRows, slotRows, textureRows] = await Promise.all([
      database.table('CreatureDisplayInfo', ['ModelID', 'ExtendedDisplayInfoID', 'CreatureModelScale', 'TextureVariationFileDataID']),
      database.table('CreatureModelData', ['FileDataID']),
      database.table('CreatureDisplayInfoExtra', ['DisplayRaceID', 'DisplaySexID', 'BakeMaterialResourcesID', 'HDBakeMaterialResourcesID']),
      database.table('NPCModelItemSlotDisplayInfo', ['ItemDisplayInfoID', 'ItemSlot', 'NpcModelID']),
      database.table('TextureFileData', ['FileDataID', 'UsageType', 'MaterialResourcesID']),
    ]);
    // Older layouts keep an NPC's choices elsewhere; without the table the NPC gets the defaults.
    const optionRows = await database
      .table('CreatureDisplayInfoOption', ['ChrCustomizationOptionID', 'ChrCustomizationChoiceID', 'CreatureDisplayInfoExtraID'])
      .then((table) => table.rows)
      .catch(() => [] as Row[]);
    // A client with no Creature table still draws NPCs by display id.
    const creatureRows = await database
      .table('Creature', ['Name_lang', 'Title_lang', 'DisplayID', 'DisplayProbability'])
      .then((table) => table.rows)
      .catch(() => [] as Row[]);

    const modelFile = new Map(modelRows.rows.map((row) => [n(row.ID), n(row.FileDataID)]));
    const fileByMaterial = new Map<number, number>();
    for (const row of textureRows.rows) if (n(row.UsageType) === 0) fileByMaterial.set(n(row.MaterialResourcesID), n(row.FileDataID));

    const wearByExtra = new Map<number, Map<Slot, number>>();
    for (const row of slotRows.rows) {
      const slot = NPC_SLOTS[n(row.ItemSlot)];
      if (!slot) continue;
      const extraId = n(row.NpcModelID);
      let wear = wearByExtra.get(extraId);
      if (!wear) wearByExtra.set(extraId, (wear = new Map()));
      wear.set(slot, n(row.ItemDisplayInfoID));
    }
    const choicesByExtra = new Map<number, Map<number, number>>();
    for (const row of optionRows) {
      const extraId = n(row.CreatureDisplayInfoExtraID);
      let choices = choicesByExtra.get(extraId);
      if (!choices) choicesByExtra.set(extraId, (choices = new Map()));
      choices.set(n(row.ChrCustomizationOptionID), n(row.ChrCustomizationChoiceID));
    }
    const extras = new Map<number, HumanoidDisplay>();
    for (const row of extraRows.rows) {
      const extraId = n(row.ID);
      extras.set(extraId, {
        extraId,
        raceId: n(row.DisplayRaceID),
        sex: n(row.DisplaySexID),
        choices: choicesByExtra.get(extraId) ?? new Map(),
        wear: wearByExtra.get(extraId) ?? new Map(),
        bakeFileId: fileByMaterial.get(n(row.BakeMaterialResourcesID)) ?? 0,
        hdBakeFileId: fileByMaterial.get(n(row.HDBakeMaterialResourcesID)) ?? 0,
      });
    }

    const displays = new Map<number, CreatureDisplay>();
    for (const row of displayRows.rows) {
      const humanoid = extras.get(n(row.ExtendedDisplayInfoID));
      displays.set(n(row.ID), {
        id: n(row.ID),
        modelFileId: modelFile.get(n(row.ModelID)) ?? 0,
        scale: n(row.CreatureModelScale) || 1,
        textures: list(row.TextureVariationFileDataID).slice(0, 3),
        ...(humanoid && { humanoid }),
      });
    }

    const creatures: CreatureInfo[] = creatureRows
      .map((row) => ({
        id: n(row.ID),
        name: String(row.Name_lang ?? ''),
        title: String(row.Title_lang ?? ''),
        displays: list(row.DisplayID)
          .filter((id, i) => id !== 0 && (list(row.DisplayProbability)[i] ?? 0) > 0)
          .map((id) => ({ id, scale: displays.get(id)?.scale ?? 1 })),
      }))
      .filter((creature) => creature.name !== '' && creature.displays.length > 0)
      .sort((a, b) => a.id - b.id);

    return new Creatures(displays, creatures);
  }

  /** A creature display by id, or undefined if the game data has none. */
  display(id: number): CreatureDisplay | undefined {
    return this.displays.get(id);
  }
}
