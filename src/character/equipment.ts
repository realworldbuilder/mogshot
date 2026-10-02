import type { Database } from '../db2/database';
import type { Row } from '../db2/wdc';

/*
 * The game's item data: which items exist for each visible slot, and what wearing one does
 * to a character (geosets, textures painted on the body, models attached or worn).
 *
 * The table relationships and the slot rules follow wow.export's item caches
 * (MIT, Kruithne and Marlamin).
 */

export type Slot =
  | 'head' | 'shoulder' | 'back' | 'chest' | 'shirt' | 'tabard' | 'wrist'
  | 'hands' | 'waist' | 'legs' | 'feet' | 'mainHand' | 'offHand';

export interface SlotInfo {
  id: Slot;
  name: string;
  /** Item inventory types that go in this slot. */
  inventoryTypes: number[];
}

/** The slots that show on a character, in the order they are listed. */
export const SLOTS: SlotInfo[] = [
  { id: 'head', name: 'Head', inventoryTypes: [1] },
  { id: 'shoulder', name: 'Shoulders', inventoryTypes: [3] },
  { id: 'back', name: 'Back', inventoryTypes: [16] },
  { id: 'chest', name: 'Chest', inventoryTypes: [5, 20] },
  { id: 'shirt', name: 'Shirt', inventoryTypes: [4] },
  { id: 'tabard', name: 'Tabard', inventoryTypes: [19] },
  { id: 'wrist', name: 'Wrists', inventoryTypes: [9] },
  { id: 'hands', name: 'Hands', inventoryTypes: [10] },
  { id: 'waist', name: 'Waist', inventoryTypes: [6] },
  { id: 'legs', name: 'Legs', inventoryTypes: [7] },
  { id: 'feet', name: 'Feet', inventoryTypes: [8] },
  // One-hand, main hand, two-hand, bows, guns and wands, thrown.
  { id: 'mainHand', name: 'Main hand', inventoryTypes: [13, 21, 17, 15, 26, 25] },
  // One-hand, off hand, shields, held in off hand.
  { id: 'offHand', name: 'Off hand', inventoryTypes: [13, 22, 14, 23] },
];

export interface ItemSummary {
  id: number;
  name: string;
  /** 0 poor, 1 common, 2 uncommon, 3 rare, 4 epic, 5 legendary ... */
  quality: number;
  inventoryType: number;
  /** File ID of the icon texture, or 0. */
  iconFileId: number;
}

export type WeaponKind = 'oneHand' | 'twoHand' | 'long' | 'bow' | 'rifle' | 'crossbow' | 'thrown';

export interface ItemModel {
  fileId: number;
  /** 0 for the item's first model, 1 for its second (a pair of shoulders has two). */
  index: number;
  /** Textures for the model's slots, by texture type (2 is the item's own skin). */
  textures: Map<number, number>;
}

/** What wearing an item does to one race and sex. */
export interface ItemLook {
  item: ItemSummary;
  /** Six numbers selecting geoset variants on the character; which groups they mean depends on the slot. */
  geosetGroup: number[];
  /** The same, for models the item adds that are worn on the body. */
  attachmentGeosetGroup: number[];
  /** Geoset groups of the character to hide (a helm hiding hair, for one). */
  hideGroups: number[];
  /** Textures painted onto the body: section of the body texture and file. */
  bodyTextures: { section: number; fileId: number }[];
  models: ItemModel[];
  /** Textures for the character model's own slots when the item has no model (a cloak's cloth). */
  characterTextures: Map<number, number>;
  /** A bow: held in the left hand although it is a main-hand item. */
  bow: boolean;
  /** How a weapon is wielded, which decides the ready and attack animations. Undefined for armour. */
  weapon: WeaponKind | undefined;
  /** A shield: strapped to the forearm, not held. */
  shield: boolean;
}

interface Display {
  geosetGroup: number[];
  attachmentGeosetGroup: number[];
  helmetVis: number[];
  modelResources: number[];
  modelMaterials: number[];
}

interface ComponentInfo {
  race: number;
  gender: number;
  position: number;
}

interface RaceFallback {
  race: number;
  sex: number;
}

const n = (value: unknown): number => Number(value ?? 0);
/** Component rows that apply to either sex. */
const anyGender = (gender: number) => gender === 2 || gender === 3;

const INVENTORY_SHIELD = 14;
const INVENTORY_TWO_HAND = 17;
const CLASS_WEAPON = 2;
const SUBCLASS_BOW = 2;
/** Weapon subclasses with their own way of being held; anything else is by one or two hands. */
const WEAPON_KINDS: Record<number, WeaponKind> = { 2: 'bow', 3: 'rifle', 6: 'long', 10: 'long', 16: 'thrown', 18: 'crossbow' };

export class Equipment {
  private readonly bySlot = new Map<Slot, ItemSummary[]>();
  private readonly items = new Map<number, ItemSummary>();

  private constructor(
    summaries: ItemSummary[],
    private readonly itemClass: Map<number, { classId: number; subclassId: number }>,
    private readonly displayOfItem: Map<number, number>,
    private readonly displays: Map<number, Display>,
    private readonly bodyTextures: Map<number, { section: number; material: number }[]>,
    private readonly modelTextures: Map<number, { index: number; type: number; material: number }[]>,
    private readonly modelFiles: Map<number, number[]>,
    private readonly modelInfo: Map<number, ComponentInfo>,
    private readonly textureFiles: Map<number, number[]>,
    private readonly textureInfo: Map<number, ComponentInfo>,
    private readonly helmetHide: Map<number, Map<number, number[]>>,
    private readonly fallbacks: Map<string, { model: RaceFallback; texture: RaceFallback }>,
  ) {
    for (const summary of summaries) this.items.set(summary.id, summary);
    for (const slot of SLOTS) {
      this.bySlot.set(
        slot.id,
        summaries
          .filter((item) => slot.inventoryTypes.includes(item.inventoryType))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
      );
    }
  }

  static async load(database: Database): Promise<Equipment> {
    const [
      sparse, item, modified, appearance, display, materialRes, modelMatRes, modelFileData,
      componentModels, textureFileData, componentTextures, helmetData, races,
    ] = await Promise.all([
      database.table('ItemSparse', ['Display_lang', 'InventoryType', 'OverallQualityID']),
      database.table('Item', ['IconFileDataID', 'ClassID', 'SubclassID']),
      database.table('ItemModifiedAppearance', ['ItemID', 'ItemAppearanceModifierID', 'ItemAppearanceID']),
      database.table('ItemAppearance', ['ItemDisplayInfoID', 'DefaultIconFileDataID']),
      database.table('ItemDisplayInfo', [
        'GeosetGroup', 'AttachmentGeosetGroup', 'HelmetGeosetVis', 'ModelResourcesID', 'ModelMaterialResourcesID',
      ]),
      database.table('ItemDisplayInfoMaterialRes', ['ComponentSection', 'MaterialResourcesID', 'ItemDisplayInfoID']),
      database.table('ItemDisplayInfoModelMatRes', ['MaterialResourcesID', 'TextureType', 'ModelIndex', 'ItemDisplayInfoID']),
      database.table('ModelFileData', ['FileDataID', 'ModelResourcesID']),
      database.table('ComponentModelFileData', ['RaceID', 'GenderIndex', 'PositionIndex']),
      database.table('TextureFileData', ['FileDataID', 'UsageType', 'MaterialResourcesID']),
      database.table('ComponentTextureFileData', ['RaceID', 'GenderIndex']),
      database.table('HelmetGeosetData', ['RaceID', 'HideGeosetGroup', 'HelmetGeosetVisDataID']),
      database.table('ChrRaces', [
        'MaleModelFallbackRaceID', 'MaleModelFallbackSex', 'FemaleModelFallbackRaceID', 'FemaleModelFallbackSex',
        'MaleTextureFallbackRaceID', 'MaleTextureFallbackSex', 'FemaleTextureFallbackRaceID', 'FemaleTextureFallbackSex',
      ]),
    ]);

    const multi = (rows: Row[], key: string, value: string): Map<number, number[]> => {
      const map = new Map<number, number[]>();
      for (const row of rows) {
        const k = n(row[key]);
        let list = map.get(k);
        if (!list) map.set(k, (list = []));
        list.push(n(row[value]));
      }
      return map;
    };

    // An item's look: its appearance with the lowest modifier (0 is the plain one).
    const appearanceById = new Map(appearance.rows.map((row) => [n(row.ID), row]));
    const bestModifier = new Map<number, number>();
    const displayOfItem = new Map<number, number>();
    const iconOfItem = new Map<number, number>();
    for (const row of modified.rows) {
      const look = appearanceById.get(n(row.ItemAppearanceID));
      const displayId = n(look?.ItemDisplayInfoID);
      if (displayId === 0) continue;
      const itemId = n(row.ItemID);
      const modifier = n(row.ItemAppearanceModifierID);
      if (bestModifier.has(itemId) && bestModifier.get(itemId)! <= modifier) continue;
      bestModifier.set(itemId, modifier);
      displayOfItem.set(itemId, displayId);
      iconOfItem.set(itemId, n(look?.DefaultIconFileDataID));
    }

    const itemRows = new Map(item.rows.map((row) => [n(row.ID), row]));
    const visibleTypes = new Set(SLOTS.flatMap((slot) => slot.inventoryTypes));
    const summaries: ItemSummary[] = [];
    const seen = new Set<string>();
    for (const row of sparse.rows) {
      const id = n(row.ID);
      const inventoryType = n(row.InventoryType);
      const displayId = displayOfItem.get(id);
      const name = String(row.Display_lang);
      if (!visibleTypes.has(inventoryType) || displayId === undefined || name === '') continue;
      // Many items share a name and a look (quest and drop versions); list one of each.
      const key = `${name}\u0000${displayId}\u0000${inventoryType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      summaries.push({
        id,
        name,
        quality: n(row.OverallQualityID),
        inventoryType,
        iconFileId: n(itemRows.get(id)?.IconFileDataID) || iconOfItem.get(id) || 0,
      });
    }

    const bodyTextures = new Map<number, { section: number; material: number }[]>();
    for (const row of materialRes.rows) {
      const id = n(row.ItemDisplayInfoID);
      let list = bodyTextures.get(id);
      if (!list) bodyTextures.set(id, (list = []));
      list.push({ section: n(row.ComponentSection), material: n(row.MaterialResourcesID) });
    }
    const modelTextures = new Map<number, { index: number; type: number; material: number }[]>();
    for (const row of modelMatRes.rows) {
      const id = n(row.ItemDisplayInfoID);
      let list = modelTextures.get(id);
      if (!list) modelTextures.set(id, (list = []));
      list.push({ index: n(row.ModelIndex), type: n(row.TextureType), material: n(row.MaterialResourcesID) });
    }

    const helmetHide = new Map<number, Map<number, number[]>>();
    for (const row of helmetData.rows) {
      const vis = n(row.HelmetGeosetVisDataID);
      let byRace = helmetHide.get(vis);
      if (!byRace) helmetHide.set(vis, (byRace = new Map()));
      const race = n(row.RaceID);
      let groups = byRace.get(race);
      if (!groups) byRace.set(race, (groups = []));
      groups.push(n(row.HideGeosetGroup));
    }

    const fallbacks = new Map<string, { model: RaceFallback; texture: RaceFallback }>();
    for (const row of races.rows) {
      for (const [sex, prefix] of [[0, 'Male'], [1, 'Female']] as const) {
        fallbacks.set(`${n(row.ID)}:${sex}`, {
          model: { race: n(row[`${prefix}ModelFallbackRaceID`]), sex: n(row[`${prefix}ModelFallbackSex`]) },
          texture: { race: n(row[`${prefix}TextureFallbackRaceID`]), sex: n(row[`${prefix}TextureFallbackSex`]) },
        });
      }
    }

    const component = (rows: Row[], position: boolean) =>
      new Map(
        rows.map((row) => [
          n(row.ID),
          { race: n(row.RaceID), gender: n(row.GenderIndex), position: position ? n(row.PositionIndex) : -1 },
        ]),
      );

    return new Equipment(
      summaries,
      new Map(item.rows.map((row) => [n(row.ID), { classId: n(row.ClassID), subclassId: n(row.SubclassID) }])),
      displayOfItem,
      new Map(
        display.rows.map((row) => [
          n(row.ID),
          {
            geosetGroup: row.GeosetGroup as number[],
            attachmentGeosetGroup: row.AttachmentGeosetGroup as number[],
            helmetVis: row.HelmetGeosetVis as number[],
            modelResources: row.ModelResourcesID as number[],
            modelMaterials: row.ModelMaterialResourcesID as number[],
          },
        ]),
      ),
      bodyTextures,
      modelTextures,
      multi(modelFileData.rows, 'ModelResourcesID', 'FileDataID'),
      component(componentModels.rows, true),
      multi(textureFileData.rows.filter((row) => n(row.UsageType) === 0), 'MaterialResourcesID', 'FileDataID'),
      component(componentTextures.rows, false),
      helmetHide,
      fallbacks,
    );
  }

  item(id: number): ItemSummary | undefined {
    return this.items.get(id);
  }

  /**
   * Items for a slot whose name contains every word of the query. An empty query lists
   * the slot from the start of the alphabet. Names that start with the query come first.
   */
  search(slot: Slot, query: string, limit = 60): { items: ItemSummary[]; total: number } {
    const all = this.bySlot.get(slot) ?? [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return { items: all.slice(0, limit), total: all.length };
    const whole = words.join(' ');
    const starts: ItemSummary[] = [];
    const contains: ItemSummary[] = [];
    for (const item of all) {
      const name = item.name.toLowerCase();
      if (!words.every((word) => name.includes(word)) && String(item.id) !== whole) continue;
      (name.startsWith(whole) ? starts : contains).push(item);
    }
    const found = [...starts, ...contains];
    return { items: found.slice(0, limit), total: found.length };
  }

  /**
   * Pick the file made for a race and sex out of the variants of a model or texture.
   * Order: the race itself, the race it falls back to, any race; then the first file.
   * A row for either sex counts as a match for both.
   */
  private pick(
    files: readonly number[],
    info: ReadonlyMap<number, ComponentInfo>,
    race: number,
    sex: number,
    fallback: RaceFallback | undefined,
    position = -1,
  ): number | undefined {
    let candidates = files;
    if (position >= 0 && files.some((file) => (info.get(file)?.position ?? -1) >= 0)) {
      candidates = files.filter((file) => info.get(file)?.position === position);
    }
    if (candidates.length <= 1) return candidates[0];
    const find = (r: number, s: number) =>
      candidates.find((file) => {
        const row = info.get(file);
        return row !== undefined && row.race === r && (row.gender === s || anyGender(row.gender));
      });
    return (
      find(race, sex) ??
      (fallback && fallback.race > 0 ? find(fallback.race, fallback.sex) : undefined) ??
      find(0, sex) ??
      // Files with no row carry no restriction.
      candidates.find((file) => !info.has(file)) ??
      candidates[0]
    );
  }

  /** What wearing an item does to a race and sex, or undefined if the item is unknown. */
  look(itemId: number, slot: Slot, race: number, sex: number): ItemLook | undefined {
    const item = this.items.get(itemId);
    const display = this.displays.get(this.displayOfItem.get(itemId) ?? 0);
    if (!item || !display) return undefined;
    const displayId = this.displayOfItem.get(itemId)!;
    const fallback = this.fallbacks.get(`${race}:${sex}`);

    const texture = (material: number): number | undefined => {
      const files = this.textureFiles.get(material);
      return files && this.pick(files, this.textureInfo, race, sex, fallback?.texture);
    };

    const bodyTextures: ItemLook['bodyTextures'] = [];
    for (const { section, material } of this.bodyTextures.get(displayId) ?? []) {
      const fileId = texture(material);
      if (fileId) bodyTextures.push({ section, fileId });
    }

    // Textures for the item's models: by model and texture type, with the older single
    // "model material" as the item's own skin (type 2).
    const texturesFor = (index: number): Map<number, number> => {
      const textures = new Map<number, number>();
      const legacy = texture(display.modelMaterials[index] ?? 0);
      if (legacy) textures.set(2, legacy);
      for (const row of this.modelTextures.get(displayId) ?? []) {
        if (row.index !== index) continue;
        const fileId = texture(row.material);
        if (fileId) textures.set(row.type, fileId);
      }
      return textures;
    };

    const models: ItemModel[] = [];
    display.modelResources.forEach((resource, index) => {
      if (!resource) return;
      const files = this.modelFiles.get(resource);
      // A pair of shoulders can share one set of files that says which is left and which is right.
      const fileId = files && this.pick(files, this.modelInfo, race, sex, fallback?.model, slot === 'shoulder' ? index : -1);
      if (fileId) models.push({ fileId, index, textures: texturesFor(index) });
    });

    const vis = display.helmetVis[sex] ?? 0;
    const byRace = this.helmetHide.get(vis);
    const hideGroups = byRace?.get(race) ?? (fallback ? byRace?.get(fallback.model.race) : undefined) ?? [];

    const kind = this.itemClass.get(itemId);
    return {
      item,
      geosetGroup: display.geosetGroup,
      attachmentGeosetGroup: display.attachmentGeosetGroup,
      hideGroups,
      bodyTextures,
      models,
      characterTextures: models.length === 0 ? texturesFor(0) : new Map(),
      bow: kind?.classId === CLASS_WEAPON && kind.subclassId === SUBCLASS_BOW,
      weapon:
        kind?.classId === CLASS_WEAPON
          ? (WEAPON_KINDS[kind.subclassId] ?? (item.inventoryType === INVENTORY_TWO_HAND ? 'twoHand' : 'oneHand'))
          : undefined,
      shield: item.inventoryType === INVENTORY_SHIELD,
    };
  }
}
