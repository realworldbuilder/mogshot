import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at, readSavedVariables } from '../../src/import/lua';

const fixture = readFileSync(new URL('../fixtures/Mogshot.lua', import.meta.url), 'utf8');

describe('Lua SavedVariables reader', () => {
  it('reads the game’s table syntax: string keys, integer keys, nesting, holes, comments', () => {
    const vars = readSavedVariables(fixture);
    expect([...vars.keys()]).toEqual(['MogshotDB', 'MogshotOther']);
    const db = vars.get('MogshotDB');
    expect(at(db, 'Rambleon-Classic Beta PvE', 'gear', 'head')).toBe(16963);
    expect(at(db, 'Rambleon-Classic Beta PvE', 'choices', 24)).toBe(1341);
    expect(at(db, 'Rambleon-Classic Beta PvE', 'x')).toBeCloseTo(72.5, 3);
    expect(at(db, 'Rambleon-Classic Beta PvE', 'dx')).toBe(-3);
    expect(at(db, 'Rambleon-Classic Beta PvE', 'shown')).toBe(false);
    expect(at(db, 'Rambleon-Classic Beta PvE', 'ctx')).toBe(true);
    // Positional values count from 1; nil takes a position without storing anything.
    expect(at(db, 'Rambleon-Classic Beta PvE', 'history', 1)).toBe('first');
    expect(at(db, 'Rambleon-Classic Beta PvE', 'history', 2)).toBeUndefined();
    expect(at(db, 'Rambleon-Classic Beta PvE', 'history', 3)).toBe('third');
    expect(at(vars.get('MogshotOther'), 3)).toBe(3);
  });

  it('decodes byte escapes as UTF-8', () => {
    const db = readSavedVariables(fixture).get('MogshotDB');
    expect(at(db, 'Renée-Whitemane', 'race')).toBe('Human');
    expect(readSavedVariables('S = "a\\"b\\\\c\\n"').get('S')).toBe('a"b\\c\n');
  });

  it('reads an empty table and keys without brackets', () => {
    const vars = readSavedVariables('A = {}\nB = { x = 1, y = { true, false } }');
    expect(vars.get('A')).toEqual(new Map());
    expect(at(vars.get('B'), 'x')).toBe(1);
    expect(at(vars.get('B'), 'y', 2)).toBe(false);
  });

  it('says where a broken file stops', () => {
    expect(() => readSavedVariables('A = {\n["x"] = 1,\n["y"] = {\n')).toThrow(/Line 4/);
    expect(() => readSavedVariables('A = {\n["x"] = ,\n}')).toThrow(/Line 2/);
    expect(() => readSavedVariables('A = "open')).toThrow(/unterminated/);
  });
});
