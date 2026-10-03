import type { Database } from '../db2/database';
import type { Row } from '../db2/wdc';

/*
 * The game's loading screens, offered as backdrops. They are the only 2D art the page can
 * reach by name: files are read by numeric ID, and the LoadingScreens table lists the IDs
 * while the Map table says which zone or instance each screen belongs to.
 */

export interface LoadingScreen {
  /** The LoadingScreens row. */
  id: number;
  /** The picture's file. */
  fileId: number;
  /** The first maps (by ID) that show this screen, or "Loading screen N" when none does. */
  name: string;
  /** True for a modern wide picture, false for a classic 4:3 one. */
  wide: boolean;
}

const n = (value: unknown): number => Number(value ?? 0);

/** Map names that are developer leftovers, not places. */
const JUNK_NAME = /^<|nothing to see here|\btest\b/i;

/** The screens worth offering, named and sorted. Rows that share a picture are listed once. */
export function loadingScreens(screens: readonly Row[], maps: readonly Row[]): LoadingScreen[] {
  // Each screen's map names with the lowest map ID that uses them: the continents are maps 0 and 1.
  const namesOfScreen = new Map<number, Map<string, number>>();
  for (const map of maps) {
    const screenId = n(map.LoadingScreenID);
    const name = String(map.MapName_lang ?? '').trim();
    if (screenId === 0 || name === '' || JUNK_NAME.test(name)) continue;
    let names = namesOfScreen.get(screenId);
    if (!names) namesOfScreen.set(screenId, (names = new Map()));
    names.set(name, Math.min(n(map.ID), names.get(name) ?? Infinity));
  }

  const byFile = new Map<number, { id: number; wide: boolean; names: Map<string, number> }>();
  for (const row of screens) {
    const wide = [row.MainImageFileDataID, row.WideScreen169FileDataID, row.WideScreenFileDataID].map(n).find((id) => id > 0);
    const fileId = wide ?? n(row.NarrowScreenFileDataID);
    if (fileId === 0) continue;
    const id = n(row.ID);
    const names = namesOfScreen.get(id) ?? new Map<string, number>();
    const existing = byFile.get(fileId);
    if (existing) {
      for (const [name, mapId] of names) existing.names.set(name, Math.min(mapId, existing.names.get(name) ?? Infinity));
    } else byFile.set(fileId, { id, wide: wide !== undefined, names: new Map(names) });
  }

  return [...byFile]
    .map(([fileId, { id, wide, names }]) => ({ id, fileId, wide, name: nameFor(id, names) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

/** Up to two map names in map order, then how many more; or the row number when no map names the screen. */
function nameFor(id: number, names: Map<string, number>): string {
  if (names.size === 0) return `Loading screen ${id}`;
  const ordered = [...names].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  const shown = ordered.slice(0, 2).join(', ');
  return ordered.length > 2 ? `${shown} +${ordered.length - 2}` : shown;
}

export async function loadLoadingScreens(database: Database): Promise<LoadingScreen[]> {
  const [screens, maps] = await Promise.all([
    database.table('LoadingScreens', ['NarrowScreenFileDataID', 'WideScreenFileDataID', 'WideScreen169FileDataID', 'MainImageFileDataID']),
    database.table('Map', ['MapName_lang', 'LoadingScreenID']),
  ]);
  return loadingScreens(screens.rows, maps.rows);
}
