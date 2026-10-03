import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { Session } from '../../cli/session';
import { resolveSpec, type World } from '../../cli/spec';
import { alphaBounds } from '../../src/render/export';
import { hasClient, WOW_DIR } from '../node-source';
import { decodePng } from '../png-decode';

const ROOT = join(import.meta.dirname, '..', '..');

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('a spec', () => {
  let world: World;

  beforeAll(async () => {
    const session = await Session.open(WOW_DIR, join(ROOT, 'node_modules', '.cache', 'mogshot', 'cli'));
    const [appearance, equipment, classes, screens] = await Promise.all([session.appearance(), session.equipment(), session.classes(), session.screens()]);
    world = { appearance, equipment, classes, screens, records: [] };
  }, 120_000);

  it('places names: race, set, item, choice, size, gradient', () => {
    const shot = resolveSpec(
      {
        race: 'orc', sex: 'male', set: { class: 'warrior', name: 'Dreadnaught' }, gear: { back: null, head: 22418 },
        choices: { 'Skin Color': 2 }, pose: 'Roar', camera: { yaw: 90 }, size: 'square', backdrop: 'Ember',
      },
      world,
    );
    expect(world.appearance.races.find((r) => r.id === shot.raceId)?.name).toBe('Orc');
    expect(shot.gear.get('chest')?.name).toBe('Dreadnaught Breastplate');
    expect(shot.gear.get('mainHand')).toBeDefined();
    expect(shot.choices.size).toBe(1);
    expect(shot.pose).toEqual({ preset: 'Roar' });
    expect(shot.camera.yaw).toBeCloseTo(Math.PI / 2);
    expect(shot.size).toEqual({ width: 2160, height: 2160, tight: false });
    expect(shot.backdrop).toMatchObject({ kind: 'gradient', from: '#d3652a' });
  });

  it('says what it could not place', () => {
    expect(() => resolveSpec({ race: 'Murloc' }, world)).toThrow(/no race called "Murloc".*Orc/);
    expect(() => resolveSpec({ race: 'Orc', gear: { head: 'zzzz' } }, world)).toThrow(/no head item called "zzzz"/);
    expect(() => resolveSpec({ race: 'Orc', gear: { head: 22416 } }, world)).toThrow(/does not go in the head slot/);
    expect(() => resolveSpec({ race: 'Orc', choices: { 'Skin Color': 99 } }, world)).toThrow(/Skin Color has choices 1 to/);
    expect(() => resolveSpec({ race: 'Orc', size: 'huge' }, world)).toThrow(/no size called "huge"/);
    expect(() => resolveSpec({ race: 'Orc', character: 'Nobody' }, world)).toThrow(/addon has saved none/);
    expect(() => resolveSpec({}, world)).toThrow(/no race and no character/);
  });

  it('is drawn to a PNG by the command line', async () => {
    const dir = join(ROOT, 'test-results', 'cli');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'shots.json'),
      JSON.stringify([
        { out: 'tight.png', race: 'Human', sex: 'female', set: { class: 'Paladin' }, pose: 'Ready', size: { width: 600, height: 800, tight: true } },
        { out: 'backdrop.png', race: 'Tauren', sex: 'male', pose: { animation: 'EmoteDance', at: 0.3 }, size: { width: 640, height: 360 }, backdrop: 'Frost' },
        { out: 'bad.png', race: 'Tauren', sex: 'male', pose: 'Moonwalk' },
      ]),
    );
    const { stdout } = await promisify(execFile)('node', [join(ROOT, 'bin', 'mogshot.mjs'), 'render', join(dir, 'shots.json'), '--wow', WOW_DIR]).catch(
      (error: { stdout: string; code: number }) => {
        // One spec is wrong on purpose, so the command reports failure.
        expect(error.code).toBe(1);
        return error;
      },
    );
    const [tight, backdrop, bad] = JSON.parse(stdout) as { width: number; height: number; problems: string[]; pose: string; error?: string }[];

    expect(tight!.problems).toEqual([]);
    const cut = decodePng(new Uint8Array(await readFile(join(dir, 'tight.png'))));
    expect(Math.max(cut.width, cut.height)).toBe(800);
    // Cropped to the character: its edges are within a few pixels of the picture's.
    const box = alphaBounds(cut)!;
    expect(box.width).toBeGreaterThan(cut.width - 16);
    expect(box.height).toBeGreaterThan(cut.height - 16);
    expect(cut.pixels[3]).toBe(0);

    expect(backdrop!.pose).toBe('EmoteDance');
    const whole = decodePng(new Uint8Array(await readFile(join(dir, 'backdrop.png'))));
    expect([whole.width, whole.height]).toEqual([640, 360]);
    expect(whole.pixels[3]).toBe(255);

    expect(bad!.error).toMatch(/no pose called "Moonwalk".*Stand/);
  }, 120_000);
});
