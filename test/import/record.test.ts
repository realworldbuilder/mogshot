import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  capturedAgo,
  decodeRecord,
  encodeRecord,
  type ImportedRecord,
  mergeRecords,
  recordsFromSavedVariables,
} from '../../src/import/record';

const fixture = readFileSync(new URL('../fixtures/Mogshot.lua', import.meta.url), 'utf8');

const thrall: ImportedRecord = {
  key: 'Thrall-Whitemane',
  name: 'Thrall',
  realm: 'Whitemane',
  race: 'Orc',
  raceId: 2,
  sex: 0,
  classId: 7,
  className: 'SHAMAN',
  gear: { head: 16963, mainHand: 19019, ranged: 18713 },
  choices: [[24, 1341], [25, 1402]],
  captured: 1790216430,
};

describe('imported character records', () => {
  it('round-trips through the paste code', () => {
    const code = encodeRecord(thrall);
    expect(code).toBe('MOG1;Thrall-Whitemane;Orc;2;0;7;SHAMAN;1790216430;head:16963,mainHand:19019,ranged:18713;24:1341,25:1402');
    expect(decodeRecord(code)).toEqual(thrall);
    expect(decodeRecord(`  ${code}\n`)).toEqual(thrall);
  });

  it('carries item names through the code, whatever characters they hold', () => {
    const named = { ...thrall, items: { 16963: { name: 'Helm of Wrath', quality: 4 }, 19019: { name: 'Thunderfury, Blessed: Blade; 100%', quality: 5 } } };
    const code = encodeRecord(named);
    expect(code.split(';')).toHaveLength(11);
    expect(decodeRecord(code)).toEqual(named);
  });

  it('decodes a code with empty fields, and refuses what is not a code', () => {
    const bare = decodeRecord('MOG1;Ann-Realm;Human;;1;;;;;');
    expect(bare).toEqual({ key: 'Ann-Realm', name: 'Ann', realm: 'Realm', race: 'Human', raceId: undefined, sex: 1, classId: undefined, className: undefined, gear: {}, choices: [], captured: 0 });
    expect(decodeRecord('hello')).toBeUndefined();
    expect(decodeRecord('MOG1;Ann-Realm;Human;;5;;;;;')).toBeUndefined();
    expect(decodeRecord('MOG1;Ann-Realm;Human;;1;;;;hat:1,head:x,head:12;9:,24:1')).toEqual(
      expect.objectContaining({ gear: { head: 12 }, choices: [[24, 1]] }),
    );
  });

  it('reads the addon’s file, leaving out what it does not understand', () => {
    const records = recordsFromSavedVariables(fixture);
    expect(records.map((r) => r.key)).toEqual(['Rambleon-Classic Beta PvE', 'Renée-Whitemane']);
    const [orc, human] = records;
    expect(orc).toEqual({
      key: 'Rambleon-Classic Beta PvE',
      name: 'Rambleon',
      realm: 'Classic Beta PvE',
      race: 'Orc',
      raceId: 2,
      sex: 1,
      classId: 7,
      className: 'SHAMAN',
      gear: { head: 16963, chest: 16966, mainHand: 19019, ranged: 18713 },
      choices: [[24, 1341], [25, 1402]],
      captured: 1790216430,
    });
    expect(human).toEqual(expect.objectContaining({ name: 'Renée', sex: 0, raceId: undefined, gear: { chest: 12640 }, choices: [] }));
    expect(human!.items).toEqual({ 12640: { name: 'Lionheart "Helm"', quality: 4 } });
    expect(recordsFromSavedVariables('Other = {}')).toEqual([]);
  });

  it('keeps the newest capture of a character found in several files', () => {
    const older = { ...thrall, captured: 10, gear: { head: 1 } };
    const newer = { ...thrall, captured: 20, gear: { head: 2 } };
    const other = { ...thrall, key: 'Ann-Realm', captured: 5 };
    expect(mergeRecords([[older, other], [newer]]).map((r) => [r.key, r.gear.head])).toEqual([
      ['Ann-Realm', 16963],
      ['Thrall-Whitemane', 2],
    ]);
  });

  it('says how long ago a capture was', () => {
    const now = 1_000_000_000_000;
    expect(capturedAgo(0, now)).toBe('at an unknown time');
    expect(capturedAgo(now / 1000 - 30, now)).toBe('just now');
    expect(capturedAgo(now / 1000 - 600, now)).toBe('10 min ago');
    expect(capturedAgo(now / 1000 - 7200, now)).toBe('2 h ago');
    expect(capturedAgo(now / 1000 - 86400 * 3, now)).toBe('3 days ago');
  });
});
