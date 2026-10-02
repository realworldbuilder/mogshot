import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import type { Row, Value } from '../../src/db2/wdc';
import { cachedFetch } from '../cached-fetch';
import { parseCsv } from '../csv';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

/** Every table the character and gear pipeline reads. */
const TABLES = [
  'ChrRaces',
  'ChrRaceXChrModel',
  'ChrModel',
  'ChrClasses',
  'CreatureDisplayInfo',
  'CreatureModelData',
  'ChrCustomizationCategory',
  'ChrCustomizationOption',
  'ChrCustomizationChoice',
  'ChrCustomizationReq',
  'ChrCustomizationReqChoice',
  'ChrCustomizationElement',
  'ChrCustomizationGeoset',
  'ChrCustomizationSkinnedModel',
  'ChrCustomizationMaterial',
  'ChrCustomizationBoneSet',
  'ChrCustomizationCondModel',
  'ChrCustomizationDisplayInfo',
  'ChrModelTextureLayer',
  'ChrModelMaterial',
  'CharBaseInfo',
  'TextureFileData',
  'CharComponentTextureLayouts',
  'CharComponentTextureSections',
  'ItemSparse',
  'Item',
  'ItemModifiedAppearance',
  'ItemAppearance',
  'ItemDisplayInfo',
  'ItemDisplayInfoMaterialRes',
  'ItemDisplayInfoModelMatRes',
  'ComponentTextureFileData',
  'ModelFileData',
  'ComponentModelFileData',
  'HelmetGeosetData',
  'ItemSet',
  'AnimationData',
];

/**
 * Does our decoded value equal the cell wago.tools exported? Integers must be equal.
 * Floats are compared as 32-bit values, or to four significant digits where the export
 * printed a tiny value in shortened scientific notation.
 */
function sameValue(ours: Value | undefined, cell: string): boolean {
  if (ours === undefined) return false;
  if (typeof ours === 'string') return ours === cell;
  if (typeof ours === 'bigint') return ours === BigInt(cell);
  if (typeof ours === 'number') {
    const theirs = Number(cell);
    if (ours === theirs || Math.fround(ours) === Math.fround(theirs)) return true;
    return !Number.isInteger(ours) && /E-/.test(cell) && Math.abs(ours - theirs) <= Math.abs(ours) * 1e-4;
  }
  return false;
}

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('database tables against wago.tools for the same build', () => {
  let storage: CascStorage;
  let database: Database;

  beforeAll(async () => {
    storage = await CascStorage.open(new NodeSource(WOW_DIR));
    database = new Database(
      storage,
      new Definitions(async (url) => {
        const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
        if (text === undefined) throw new Error(`Could not fetch ${url}`);
        return text;
      }),
    );
  }, 120_000);

  it.for(TABLES)('%s', { timeout: 120_000 }, async (name, ctx) => {
    const build = storage.info.version;
    const csv = await cachedFetch(`https://wago.tools/db2/${name}/csv?build=${build}`, `wago/${build}/${name}.csv`);
    // No reference for this build (or offline): skipped, not passed.
    if (csv === undefined || csv.trim() === '') return ctx.skip();

    const start = performance.now();
    const table = await database.table(name);
    const ms = performance.now() - start;

    const [head, ...lines] = parseCsv(csv);
    const idCell = head!.indexOf(table.idColumn);
    expect(idCell).toBeGreaterThanOrEqual(0);
    const ours = new Map<number, Row>(table.rows.map((row) => [row[table.idColumn] as number, row]));

    const mismatches: string[] = [];
    let missing = 0;
    for (const line of lines) {
      const id = Number(line[idCell]);
      const row = ours.get(id);
      if (!row) {
        missing++;
        continue;
      }
      head!.forEach((column, i) => {
        // Array columns are exported as Name_0, Name_1, ...
        const array = column in row ? null : /^(.+)_(\d+)$/.exec(column);
        const value = array ? (row[array[1]!] as Value[] | undefined)?.[Number(array[2])] : row[column];
        if (!sameValue(value as Value | undefined, line[i]!) && mismatches.length < 5) {
          mismatches.push(`${name} #${id} ${column}: ours ${String(value)} theirs ${line[i]}`);
        }
      });
    }

    const skippedRows = table.skipped.reduce((n, section) => n + section.rowCount, 0);
    console.log(
      `${name}: ${table.rows.length} rows in ${ms.toFixed(0)} ms; wago ${lines.length}; ` +
        `${table.skipped.length} encrypted sections skipped (${skippedRows} rows)`,
    );
    expect(mismatches).toEqual([]);
    // Every row the reference has, we have, except rows inside sections we could not decrypt.
    expect(missing).toBeLessThanOrEqual(skippedRows);
    // And we invent none.
    expect(table.rows.length).toBeLessThanOrEqual(lines.length);
  });
});
