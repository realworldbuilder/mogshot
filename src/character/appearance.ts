import type { Database } from '../db2/database';
import type { Row } from '../db2/wdc';

/*
 * The game's character appearance data: which model a race and sex use, which options and
 * choices that model has, and what each choice does (show a geoset, add a texture layer,
 * reshape bones, attach a model).
 *
 * The table relationships follow wow.export's DBCharacterCustomization (MIT, Kruithne).
 */

export interface CharacterModel {
  chrModelId: number;
  /** File ID of the model's .m2. */
  fileId: number;
  /** Which texture layout (section rectangles, layer order) the model's skin uses. */
  layoutId: number;
}

export interface Race {
  id: number;
  name: string;
  /** Sexes the race has a model for: 0 = male, 1 = female. */
  sexes: number[];
}

export interface Choice {
  id: number;
  name: string;
  /** False for choices only non-player characters or special classes can use. */
  available: boolean;
  /** Up to two CSS colours for colour choices (skin, hair, eyes), as the game shows them. */
  swatches: string[];
}

export interface Option {
  id: number;
  name: string;
  /**
   * Not offered on the character creation screen of this product. Its first choice still
   * applies: the undead jaw, for one, comes from such an option.
   */
  hidden: boolean;
  choices: Choice[];
}

/** One texture to draw into the composited texture of a slot. */
export interface TextureLayer {
  /** The model texture slot this builds (1 = skin, 6 = hair, ...). */
  textureType: number;
  layer: number;
  blendMode: number;
  fileId: number;
  /** Full size of the slot's texture. */
  canvasWidth: number;
  canvasHeight: number;
  /** Where the layer goes, in full-size pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Resolved {
  /**
   * Geosets to switch on or off, in order. An option switches off every geoset its choices
   * name and switches on those of the chosen one; geosets no option names keep their default.
   * `id` is group * 100 + variant.
   */
  geosets: { id: number; visible: boolean }[];
  /** Texture layers, sorted in drawing order within each slot. */
  layers: TextureLayer[];
  /** Files of bone adjustments (face shapes) the choices ask for. */
  boneFiles: number[];
  /** Geosets of other models that the choices add to the character, skinned to its bones. */
  skinnedModels: { fileId: number; group: number; variant: number }[];
  /** Things the data asked for that could not be resolved. */
  problems: string[];
}

interface Element {
  relatedChoiceId: number;
  geosetId: number;
  materialId: number;
  boneSetId: number;
  skinnedModelId: number;
}

const OPTION_HIDDEN = 0x20;
/** The model texture slot of the body skin. */
const SLOT_SKIN = 1;
const BLEND_ALPHA = 15;
const REQ_PLAYER = 0x1;
/** Bit of an ordinary class (warrior). A choice that excludes it is for special classes only. */
const CLASS_ORDINARY = 0x1;

const n = (value: unknown): number => Number(value ?? 0);

function groupBy(rows: Row[], column: string): Map<number, Row[]> {
  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const key = n(row[column]);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = []));
    group.push(row);
  }
  return groups;
}

export class Appearance {
  private constructor(
    private readonly models: Map<string, CharacterModel>,
    private readonly optionsByModel: Map<number, Option[]>,
    private readonly elementsByChoice: Map<number, Element[]>,
    private readonly geosets: Map<number, { group: number; variant: number }>,
    private readonly materials: Map<number, { target: number; fileId: number }>,
    private readonly layersByLayout: Map<number, Row[]>,
    private readonly slotSizes: Map<string, { width: number; height: number }>,
    private readonly sectionsByLayout: Map<number, Row[]>,
    private readonly boneSets: Map<number, { boneFileId: number; modelFileId: number }>,
    private readonly skinnedModels: Map<number, { fileId: number; group: number; variant: number }>,
    /** Races a player can create in this product, in name order. */
    readonly races: Race[],
  ) {}

  static async load(database: Database): Promise<Appearance> {
    const [
      raceModels, chrModels, displays, modelData, options, choices, reqs, elements,
      geosets, materials, textureFiles, layers, slotMaterials, sections, boneSets, skinnedModels, chrRaces, creatable,
    ] = await Promise.all([
      database.table('ChrRaceXChrModel', ['ChrRacesID', 'ChrModelID', 'Sex']),
      database.table('ChrModel', ['DisplayID', 'CharComponentTextureLayoutID']),
      database.table('CreatureDisplayInfo', ['ModelID']),
      database.table('CreatureModelData', ['FileDataID']),
      database.table('ChrCustomizationOption', ['Name_lang', 'ChrModelID', 'OrderIndex', 'Flags']),
      database.table('ChrCustomizationChoice', ['Name_lang', 'ChrCustomizationOptionID', 'ChrCustomizationReqID', 'OrderIndex', 'SwatchColor']),
      database.table('ChrCustomizationReq', ['ReqType', 'ClassMask']),
      database.table('ChrCustomizationElement', [
        'ChrCustomizationChoiceID', 'RelatedChrCustomizationChoiceID', 'ChrCustomizationGeosetID',
        'ChrCustomizationMaterialID', 'ChrCustomizationBoneSetID', 'ChrCustomizationSkinnedModelID',
      ]),
      database.table('ChrCustomizationGeoset', ['GeosetType', 'GeosetID']),
      database.table('ChrCustomizationMaterial', ['ChrModelTextureTargetID', 'MaterialResourcesID']),
      database.table('TextureFileData', ['FileDataID', 'UsageType', 'MaterialResourcesID']),
      database.table('ChrModelTextureLayer', [
        'TextureType', 'Layer', 'BlendMode', 'TextureSectionTypeBitMask', 'ChrModelTextureTargetID', 'CharComponentTextureLayoutsID',
      ]),
      database.table('ChrModelMaterial', ['CharComponentTextureLayoutsID', 'TextureType', 'Width', 'Height']),
      database.table('CharComponentTextureSections', ['CharComponentTextureLayoutID', 'SectionType', 'X', 'Y', 'Width', 'Height']),
      database.table('ChrCustomizationBoneSet', ['BoneFileDataID', 'ModelFileDataID']),
      database.table('ChrCustomizationSkinnedModel', ['CollectionsFileDataID', 'GeosetType', 'GeosetID']),
      database.table('ChrRaces', ['Name_lang']),
      // The race and class combinations the character creation screen offers.
      database.table('CharBaseInfo', ['RaceID']),
    ]);

    const byId = (rows: Row[]) => new Map(rows.map((row) => [n(row.ID), row]));
    const displayById = byId(displays.rows);
    const modelDataById = byId(modelData.rows);
    const chrModelById = byId(chrModels.rows);
    const reqById = byId(reqs.rows);

    const models = new Map<string, CharacterModel>();
    for (const row of raceModels.rows) {
      const chrModel = chrModelById.get(n(row.ChrModelID));
      const display = chrModel && displayById.get(n(chrModel.DisplayID));
      const data = display && modelDataById.get(n(display.ModelID));
      if (!chrModel || !data) continue;
      models.set(`${n(row.ChrRacesID)}:${n(row.Sex)}`, {
        chrModelId: n(chrModel.ID),
        fileId: n(data.FileDataID),
        layoutId: n(chrModel.CharComponentTextureLayoutID),
      });
    }

    const byOrder = (a: Row, b: Row) => n(a.OrderIndex) - n(b.OrderIndex) || n(a.ID) - n(b.ID);
    const choicesByOption = groupBy(choices.rows, 'ChrCustomizationOptionID');
    const optionsByModel = new Map<number, Option[]>();
    for (const [modelId, rows] of groupBy(options.rows, 'ChrModelID')) {
      optionsByModel.set(
        modelId,
        rows
          .sort(byOrder)
          .map((row) => ({
            id: n(row.ID),
            name: String(row.Name_lang),
            hidden: (n(row.Flags) & OPTION_HIDDEN) !== 0,
            choices: (choicesByOption.get(n(row.ID)) ?? []).sort(byOrder).map((choice) => {
              const req = reqById.get(n(choice.ChrCustomizationReqID));
              const classMask = n(req?.ClassMask);
              const available =
                !req || ((n(req.ReqType) & REQ_PLAYER) !== 0 && (classMask === 0 || (classMask & CLASS_ORDINARY) !== 0));
              // Swatch colours are stored as ARGB words; 0 means none.
              const swatches = ((choice.SwatchColor as number[] | undefined) ?? [])
                .filter((color) => color !== 0)
                .map((color) => `#${(color & 0xffffff).toString(16).padStart(6, '0')}`);
              return { id: n(choice.ID), name: String(choice.Name_lang), available, swatches };
            }),
          })),
      );
    }

    const elementsByChoice = new Map<number, Element[]>();
    for (const row of elements.rows) {
      const choiceId = n(row.ChrCustomizationChoiceID);
      let list = elementsByChoice.get(choiceId);
      if (!list) elementsByChoice.set(choiceId, (list = []));
      list.push({
        relatedChoiceId: n(row.RelatedChrCustomizationChoiceID),
        geosetId: n(row.ChrCustomizationGeosetID),
        materialId: n(row.ChrCustomizationMaterialID),
        boneSetId: n(row.ChrCustomizationBoneSetID),
        skinnedModelId: n(row.ChrCustomizationSkinnedModelID),
      });
    }

    const fileByMaterialResource = new Map<number, number>();
    for (const row of textureFiles.rows) {
      if (n(row.UsageType) === 0) fileByMaterialResource.set(n(row.MaterialResourcesID), n(row.FileDataID));
    }

    const creatableRaces = new Set(creatable.rows.map((row) => n(row.RaceID)));
    const races: Race[] = chrRaces.rows
      .filter((row) => creatableRaces.has(n(row.ID)))
      .map((row) => ({
        id: n(row.ID),
        name: String(row.Name_lang),
        sexes: [0, 1].filter((sex) => models.has(`${n(row.ID)}:${sex}`)),
      }))
      .filter((race) => race.sexes.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    return new Appearance(
      models,
      optionsByModel,
      elementsByChoice,
      new Map(geosets.rows.map((row) => [n(row.ID), { group: n(row.GeosetType), variant: n(row.GeosetID) }])),
      new Map(
        materials.rows.map((row) => [
          n(row.ID),
          { target: n(row.ChrModelTextureTargetID), fileId: fileByMaterialResource.get(n(row.MaterialResourcesID)) ?? 0 },
        ]),
      ),
      groupBy(layers.rows, 'CharComponentTextureLayoutsID'),
      new Map(
        slotMaterials.rows.map((row) => [
          `${n(row.CharComponentTextureLayoutsID)}:${n(row.TextureType)}`,
          { width: n(row.Width), height: n(row.Height) },
        ]),
      ),
      groupBy(sections.rows, 'CharComponentTextureLayoutID'),
      new Map(boneSets.rows.map((row) => [n(row.ID), { boneFileId: n(row.BoneFileDataID), modelFileId: n(row.ModelFileDataID) }])),
      new Map(
        skinnedModels.rows.map((row) => [
          n(row.ID),
          { fileId: n(row.CollectionsFileDataID), group: n(row.GeosetType), variant: n(row.GeosetID) },
        ]),
      ),
      races,
    );
  }

  /** The model for a race and sex (0 = male, 1 = female). */
  model(raceId: number, sex: number): CharacterModel | undefined {
    return this.models.get(`${raceId}:${sex}`);
  }

  /** The model's appearance options in the game's order, each with its choices. Includes hidden ones. */
  options(chrModelId: number): Option[] {
    return this.optionsByModel.get(chrModelId) ?? [];
  }

  /** The first available choice of every option. */
  defaultChoices(chrModelId: number): Map<number, number> {
    const chosen = new Map<number, number>();
    for (const option of this.options(chrModelId)) {
      const choice = option.choices.find((c) => c.available);
      if (choice) chosen.set(option.id, choice.id);
    }
    return chosen;
  }

  /**
   * A layer that paints a texture onto one section of the body texture (an armour piece).
   * Undefined if the model's layout has no such section.
   */
  bodyLayer(model: CharacterModel, section: number, fileId: number, order: number): TextureLayer | undefined {
    const size = this.slotSizes.get(`${model.layoutId}:${SLOT_SKIN}`);
    const row = (this.sectionsByLayout.get(model.layoutId) ?? []).find((r) => n(r.SectionType) === section);
    if (!size || !row) return undefined;
    return {
      textureType: SLOT_SKIN,
      layer: order,
      blendMode: BLEND_ALPHA,
      fileId,
      canvasWidth: size.width,
      canvasHeight: size.height,
      x: n(row.X),
      y: n(row.Y),
      width: n(row.Width),
      height: n(row.Height),
    };
  }

  /** What a set of choices (option ID -> choice ID) does to the model. */
  resolve(model: CharacterModel, choices: ReadonlyMap<number, number>): Resolved {
    const active = new Set(choices.values());
    const resolved: Resolved = { geosets: [], layers: [], boneFiles: [], skinnedModels: [], problems: [] };
    const layerRows = this.layersByLayout.get(model.layoutId) ?? [];
    const sections = this.sectionsByLayout.get(model.layoutId) ?? [];
    const order = new Map<TextureLayer, number>();

    for (const option of this.options(model.chrModelId)) {
      const choiceId = choices.get(option.id);
      if (choiceId === undefined) continue;
      for (const choice of option.choices) {
        if (choice.id === choiceId) continue;
        for (const element of this.elementsByChoice.get(choice.id) ?? []) {
          const geoset = this.geosets.get(element.geosetId);
          if (geoset) resolved.geosets.push({ id: geoset.group * 100 + geoset.variant, visible: false });
        }
      }
      for (const element of this.elementsByChoice.get(choiceId) ?? []) {
        // Some elements only apply together with another choice (a face texture per skin colour).
        if (element.relatedChoiceId !== 0 && !active.has(element.relatedChoiceId)) continue;

        if (element.geosetId !== 0) {
          const geoset = this.geosets.get(element.geosetId);
          if (geoset) resolved.geosets.push({ id: geoset.group * 100 + geoset.variant, visible: true });
        }
        if (element.boneSetId !== 0) {
          const boneSet = this.boneSets.get(element.boneSetId);
          // A bone set is made for one model file; races that share options can list another's.
          if (boneSet && (boneSet.modelFileId === 0 || boneSet.modelFileId === model.fileId)) {
            resolved.boneFiles.push(boneSet.boneFileId);
          }
        }
        if (element.skinnedModelId !== 0) {
          const skinned = this.skinnedModels.get(element.skinnedModelId);
          if (skinned) resolved.skinnedModels.push(skinned);
        }
        if (element.materialId === 0) continue;

        const material = this.materials.get(element.materialId);
        if (!material) continue;
        const layerRow = layerRows.find((row) => n((row.ChrModelTextureTargetID as number[])[0]) === material.target);
        // A target the model's layout has no layer for is not drawn on this model.
        if (!layerRow) continue;
        const textureType = n(layerRow.TextureType);
        const size = this.slotSizes.get(`${model.layoutId}:${textureType}`);
        if (!size) continue;
        if (material.fileId === 0) {
          resolved.problems.push(`${option.name}: the texture for layer ${n(layerRow.Layer)} is not listed in the game data`);
          continue;
        }

        const mask = n(layerRow.TextureSectionTypeBitMask);
        let rect = { x: 0, y: 0, width: size.width, height: size.height };
        if (mask !== -1) {
          const section = sections.find((row) => ((1 << n(row.SectionType)) & mask) !== 0);
          if (!section) continue;
          rect = { x: n(section.X), y: n(section.Y), width: n(section.Width), height: n(section.Height) };
        }
        const layer: TextureLayer = {
          textureType,
          layer: n(layerRow.Layer),
          blendMode: n(layerRow.BlendMode),
          fileId: material.fileId,
          canvasWidth: size.width,
          canvasHeight: size.height,
          ...rect,
        };
        order.set(layer, resolved.layers.length);
        resolved.layers.push(layer);
      }
    }

    resolved.layers.sort((a, b) => a.textureType - b.textureType || a.layer - b.layer || order.get(a)! - order.get(b)!);
    return resolved;
  }
}
