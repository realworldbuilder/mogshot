import type { Database } from '../db2/database';
import type { Row } from '../db2/wdc';
import { decodeBlp, type Image } from '../formats/blp';
import type { ClassEntry, Race } from './races';

/*
 * The round race and class pictures of the character creation screen. They are cells of the
 * game's interface atlas: UiTextureAtlasMember names each cell and says where it is in which
 * atlas, UiTextureAtlas says which file holds the atlas and how big it is.
 */

export interface AtlasCell {
  fileId: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** The atlas's size as the table has it; the file's picture can differ, so the cell is scaled to it. */
  atlasWidth: number;
  atlasHeight: number;
}

export interface Portraits {
  /** By `${race.key}:${sex}`. */
  races: Record<string, Image>;
  /** By class key. */
  classes: Record<string, Image>;
  /** Why some or all of the pictures are missing, in words. */
  problems: string[];
}

const n = (value: unknown): number => Number(value ?? 0);

/** The 128-pixel picture of a race and sex, and the 64-pixel one to fall back on. */
export const racePortraitNames = (key: string, sex: number): string[] => {
  const name = `${key}-${sex === 0 ? 'male' : 'female'}`;
  return [`raceicon128-${name}`, `raceicon-${name}`];
};
export const classPortraitName = (key: string): string => `classicon-${key}`;

/**
 * The cells for the wanted member names, matched without regard to case, and the names with no
 * cell. A name with no cell of its own takes a variant of it: `raceicon-skyborne-male-c60` for
 * `raceicon-skyborne-male`, the way the game names a picture made for one product.
 */
export function atlasCells(
  atlases: readonly Row[],
  members: readonly Row[],
  wanted: readonly string[],
): { cells: Map<string, AtlasCell>; missing: string[] } {
  const atlasById = new Map(atlases.map((row) => [n(row.ID), row]));
  const byName = new Map<string, AtlasCell>();
  for (const row of members) {
    const atlas = atlasById.get(n(row.UiTextureAtlasID));
    const fileId = n(atlas?.FileDataID);
    if (!atlas || fileId === 0) continue;
    const left = n(row.CommittedLeft);
    const top = n(row.CommittedTop);
    byName.set(String(row.CommittedName ?? '').toLowerCase(), {
      fileId,
      left,
      top,
      width: n(row.CommittedRight) - left,
      height: n(row.CommittedBottom) - top,
      atlasWidth: n(atlas.AtlasWidth),
      atlasHeight: n(atlas.AtlasHeight),
    });
  }
  const cells = new Map<string, AtlasCell>();
  const missing: string[] = [];
  const names = [...byName.keys()].sort();
  for (const name of wanted) {
    const key = name.toLowerCase();
    const variant = names.find((candidate) => candidate.startsWith(`${key}-`));
    const cell = byName.get(key) ?? (variant !== undefined ? byName.get(variant) : undefined);
    if (cell) cells.set(name, cell);
    else missing.push(name);
  }
  return { cells, missing };
}

/** A copy of one cell of an atlas picture, scaled to the picture's own size and kept inside it. */
export function crop(image: Image, cell: AtlasCell): Image {
  const scaleX = cell.atlasWidth > 0 ? image.width / cell.atlasWidth : 1;
  const scaleY = cell.atlasHeight > 0 ? image.height / cell.atlasHeight : 1;
  const x0 = Math.max(0, Math.min(image.width, Math.round(cell.left * scaleX)));
  const y0 = Math.max(0, Math.min(image.height, Math.round(cell.top * scaleY)));
  const x1 = Math.max(x0, Math.min(image.width, Math.round((cell.left + cell.width) * scaleX)));
  const y1 = Math.max(y0, Math.min(image.height, Math.round((cell.top + cell.height) * scaleY)));
  const width = x1 - x0;
  const height = y1 - y0;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * image.width + x0) * 4;
    pixels.set(image.pixels.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, pixels };
}

/**
 * The pictures for every race and sex and every class, read from the atlas. Whatever cannot be
 * read is left out and said in `problems`; nothing is guessed.
 */
export async function loadPortraits(
  database: Database,
  readFile: (fileId: number) => Promise<Uint8Array | undefined>,
  races: readonly Race[],
  classes: readonly ClassEntry[],
): Promise<Portraits> {
  const portraits: Portraits = { races: {}, classes: {}, problems: [] };
  // Each race and sex, and each class, with the member names that would picture it, best first.
  const wanted: { key: string; names: string[]; of: 'races' | 'classes' }[] = [];
  for (const race of races) for (const sex of race.sexes) wanted.push({ key: `${race.key}:${sex}`, names: racePortraitNames(race.key, sex), of: 'races' });
  for (const c of classes) wanted.push({ key: c.key, names: [classPortraitName(c.key)], of: 'classes' });

  let found: ReturnType<typeof atlasCells>;
  try {
    const [atlases, members] = await Promise.all([
      database.table('UiTextureAtlas', ['FileDataID', 'AtlasWidth', 'AtlasHeight']),
      database.table('UiTextureAtlasMember', ['CommittedName', 'UiTextureAtlasID', 'CommittedLeft', 'CommittedRight', 'CommittedTop', 'CommittedBottom']),
    ]);
    found = atlasCells(atlases.rows, members.rows, wanted.flatMap((w) => w.names));
  } catch (error) {
    portraits.problems.push(
      `The game's race and class pictures could not be read: ${error instanceof Error ? error.message : String(error)}. Letters are shown instead.`,
    );
    return portraits;
  }
  const missing = wanted.filter((w) => !w.names.some((name) => found.cells.has(name))).map((w) => w.names[0]!);
  if (missing.length > 0) {
    portraits.problems.push(`The game's interface atlas has no picture named ${missing.join(', ')}. Letters are shown instead.`);
  }

  // Each atlas file is read and decoded once, then every cell is cut from it.
  const files = new Map<number, Promise<Image | undefined>>();
  const picture = (fileId: number) => {
    let image = files.get(fileId);
    if (!image) {
      image = readFile(fileId).then((bytes) => (bytes ? decodeBlp(bytes) : undefined));
      files.set(fileId, image);
    }
    return image;
  };
  const unreadable = new Set<number>();
  for (const { key, names, of } of wanted) {
    const name = names.find((candidate) => found.cells.has(candidate));
    const cell = name !== undefined ? found.cells.get(name) : undefined;
    if (!cell) continue;
    let image: Image | undefined;
    try {
      image = await picture(cell.fileId);
    } catch {
      image = undefined;
    }
    if (!image) {
      unreadable.add(cell.fileId);
      continue;
    }
    portraits[of][key] = crop(image, cell);
  }
  if (unreadable.size > 0) {
    portraits.problems.push(`The atlas file${unreadable.size > 1 ? 's' : ''} ${[...unreadable].join(', ')} could not be read. Letters are shown instead.`);
  }
  return portraits;
}
