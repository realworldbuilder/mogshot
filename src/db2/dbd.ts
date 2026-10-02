/*
 * Table definitions in the WoWDBDefs `.dbd` format: a COLUMNS block naming every column
 * the table has ever had, then one block per layout listing the fields that layout stores.
 * Parsing follows wow.export's DBDParser (MIT, Kruithne and Marlamin).
 */

export type ColumnType = 'int' | 'float' | 'string' | 'locstring';

export interface DbdField {
  name: string;
  type: ColumnType;
  /** Bits per element for ints, when the layout declares it. */
  bits: number | undefined;
  unsigned: boolean;
  /** Number of elements, or undefined for a single value. */
  arrayLength: number | undefined;
  isId: boolean;
  isRelation: boolean;
  /** Stored outside the record (ID list or relationship map), so it takes no record field. */
  nonInline: boolean;
}

export interface DbdLayout {
  layoutHashes: string[];
  builds: string[];
  buildRanges: { min: string; max: string }[];
  fields: DbdField[];
}

export interface Dbd {
  columns: Map<string, ColumnType>;
  layouts: DbdLayout[];
}

const COLUMN = /^(int|float|locstring|string)(?:<[^>]+>)?\s+(\S+)/;
const FIELD = /^(?:\$([^$]+)\$)?([^<[\s]+)(?:<(u?)(\d+)>)?(?:\[(\d+)\])?$/;

const stripComment = (line: string) => line.replace(/\s*\/\/.*$/, '').trim();

export function parseDbd(text: string): Dbd {
  const columns = new Map<string, ColumnType>();
  const layouts: DbdLayout[] = [];

  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map(stripComment).filter((line) => line.length > 0);
    if (lines.length === 0) continue;

    if (lines[0] === 'COLUMNS') {
      for (const line of lines.slice(1)) {
        const match = COLUMN.exec(line);
        // A trailing '?' marks a column whose name is a guess.
        if (match) columns.set(match[2]!.replace(/\?$/, ''), match[1] as ColumnType);
      }
      continue;
    }

    const layout: DbdLayout = { layoutHashes: [], builds: [], buildRanges: [], fields: [] };
    for (const line of lines) {
      if (line.startsWith('COMMENT')) continue;
      if (line.startsWith('LAYOUT ')) {
        layout.layoutHashes.push(...line.slice(7).split(',').map((hash) => hash.trim().toUpperCase()));
        continue;
      }
      if (line.startsWith('BUILD ')) {
        for (const build of line.slice(6).split(',')) {
          const [min, max] = build.trim().split('-');
          if (max !== undefined) layout.buildRanges.push({ min: min!, max });
          else layout.builds.push(min!);
        }
        continue;
      }
      const match = FIELD.exec(line);
      if (!match) continue;
      const name = match[2]!;
      const type = columns.get(name);
      if (type === undefined) throw new Error(`Table definition has no column type for ${name}`);
      const annotations = match[1]?.split(',') ?? [];
      layout.fields.push({
        name,
        type,
        bits: match[4] === undefined ? undefined : Number(match[4]),
        unsigned: match[3] === 'u',
        arrayLength: match[5] === undefined ? undefined : Number(match[5]),
        isId: annotations.includes('id'),
        isRelation: annotations.includes('relation'),
        nonInline: annotations.includes('noninline'),
      });
    }
    layouts.push(layout);
  }

  if (columns.size === 0) throw new Error('Table definition has no COLUMNS block');
  return { columns, layouts };
}

function buildParts(build: string): number[] {
  return build.split('.').map(Number);
}

function inRange(build: string, min: string, max: string): boolean {
  const b = buildParts(build);
  const lo = buildParts(min);
  const hi = buildParts(max);
  const compare = (x: number[], y: number[]) => {
    for (let i = 0; i < 4; i++) {
      const d = (x[i] ?? 0) - (y[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  return compare(b, lo) >= 0 && compare(b, hi) <= 0;
}

/**
 * The layout for a table file. The layout hash in the file is matched first, because a new
 * game build can change a table without the definitions listing that build yet.
 */
export function findLayout(dbd: Dbd, layoutHash: string, build: string): DbdLayout | undefined {
  const hash = layoutHash.toUpperCase();
  return (
    dbd.layouts.find((layout) => layout.layoutHashes.includes(hash)) ??
    dbd.layouts.find((layout) => layout.builds.includes(build)) ??
    dbd.layouts.find((layout) => layout.buildRanges.some((range) => inRange(build, range.min, range.max)))
  );
}
