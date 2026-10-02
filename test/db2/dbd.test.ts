import { describe, expect, it } from 'vitest';
import { findLayout, parseDbd } from '../../src/db2/dbd';

const SAMPLE = `COLUMNS
int ID
locstring Name_lang
int<ChrRaces::ID> RaceID
float Scale
int Flags
int Guess?
int Mask // a comment

LAYOUT 0C5C2D13, abcdef01
BUILD 1.60.1.69000-1.60.1.70000, 1.60.1.70170
COMMENT something
$id$ID<32>
Name_lang
RaceID<u8>
Scale[3]
Flags<32> // trailing comment
Guess<16>

BUILD 1.50.0.1
$noninline,id$ID<32>
Name_lang
Mask<u64>[2]
$noninline,relation$RaceID<32>
`;

describe('parseDbd', () => {
  const dbd = parseDbd(SAMPLE);

  it('reads column types', () => {
    expect(dbd.columns.get('Name_lang')).toBe('locstring');
    expect(dbd.columns.get('Guess')).toBe('int');
    expect(dbd.columns.get('Mask')).toBe('int');
  });

  it('reads layouts with hashes, builds and fields', () => {
    expect(dbd.layouts).toHaveLength(2);
    const [first, second] = dbd.layouts;
    expect(first!.layoutHashes).toEqual(['0C5C2D13', 'ABCDEF01']);
    expect(first!.builds).toEqual(['1.60.1.70170']);
    expect(first!.buildRanges).toEqual([{ min: '1.60.1.69000', max: '1.60.1.70000' }]);
    expect(first!.fields.map((f) => f.name)).toEqual(['ID', 'Name_lang', 'RaceID', 'Scale', 'Flags', 'Guess']);
    expect(first!.fields[0]).toMatchObject({ isId: true, nonInline: false, bits: 32, unsigned: false });
    expect(first!.fields[2]).toMatchObject({ bits: 8, unsigned: true });
    expect(first!.fields[3]).toMatchObject({ type: 'float', arrayLength: 3 });
    expect(second!.fields[0]).toMatchObject({ isId: true, nonInline: true });
    expect(second!.fields[2]).toMatchObject({ bits: 64, unsigned: true, arrayLength: 2 });
    expect(second!.fields[3]).toMatchObject({ isRelation: true, nonInline: true });
  });

  it('rejects a definition without columns', () => {
    expect(() => parseDbd('LAYOUT 00000000\n')).toThrow('no COLUMNS');
    expect(() => parseDbd('LAYOUT 00000000\nID<32>\n')).toThrow('no column type for ID');
  });
});

describe('findLayout', () => {
  const dbd = parseDbd(SAMPLE);

  it('matches the layout hash before the build', () => {
    expect(findLayout(dbd, 'abcdef01', '1.50.0.1')).toBe(dbd.layouts[0]);
  });

  it('falls back to an exact build, then a build range', () => {
    expect(findLayout(dbd, 'FFFFFFFF', '1.50.0.1')).toBe(dbd.layouts[1]);
    expect(findLayout(dbd, 'FFFFFFFF', '1.60.1.69913')).toBe(dbd.layouts[0]);
    expect(findLayout(dbd, 'FFFFFFFF', '1.60.2.1')).toBeUndefined();
  });
});
