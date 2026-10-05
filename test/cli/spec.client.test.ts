import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
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
    world = { appearance, equipment, classes, screens, records: [], maps: await session.maps() };
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
    expect(() => resolveSpec({ race: 'Orc', place: { map: 'Narnia', x: 0, y: 0 } }, world)).toThrow(/no map called "Narnia"/);
    expect(resolveSpec({ race: 'Orc', place: { map: 'Kalimdor', x: 1, y: 2, facing: 90 } }, world).place).toMatchObject({ x: 1, y: 2, reach: 300 });
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

  it('films a looping clip as video, GIF and PNG frames', async () => {
    const dir = join(ROOT, 'test-results', 'cli');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'clips.json'),
      JSON.stringify([
        { out: 'stand.mp4', race: 'Dwarf', sex: 'male', clip: true, size: { width: 480, height: 480 }, backdrop: 'Ember' },
        { out: 'dance.gif', race: 'Tauren', sex: 'male', clip: { animation: 'EmoteDance' }, size: { width: 320, height: 240 }, backdrop: 'Frost' },
        { out: 'frames.zip', race: 'Human', sex: 'female', clip: { seconds: 0.2, fps: 10 }, size: { width: 200, height: 250 } },
        { out: 'place.png', race: 'Dwarf', sex: 'male', place: { x: -8833, y: 628, facing: 215 }, size: { width: 640, height: 360 } },
        { out: 'clip.png', race: 'Human', clip: true },
        { out: 'still.mp4', race: 'Human' },
        { out: 'turn.zip', race: 'Human', sex: 'female', clip: { seconds: 0.4, fps: 10, to: { yaw: 120 } }, size: { width: 200, height: 250 } },
        { out: 'looped.zip', race: 'Human', sex: 'female', clip: { seconds: 0.1, loop: true, fps: 5 }, size: { width: 100, height: 100 } },
        { out: 'nobody.png', race: 'Dwarf', sex: 'male', place: { x: -8833, y: 628, facing: 215, empty: true }, size: { width: 640, height: 360 } },
      ]),
    );
    const { stdout } = await promisify(execFile)('node', [join(ROOT, 'bin', 'mogshot.mjs'), 'render', join(dir, 'clips.json'), '--wow', WOW_DIR]).catch(
      (error: { stdout: string; code: number }) => {
        expect(error.code).toBe(1);
        return error;
      },
    );
    type Report = { width: number; height: number; problems: string[]; error?: string; clip: { animation: string; frames: number; fps: number; length: number } };
    const [stand, dance, frames, placed, wrongName, noClip, turn, looped, nobody] = JSON.parse(stdout) as (Report & { place: { ground: number[]; props: number } })[];

    expect(stand!.problems).toEqual([]);
    expect(stand!.clip).toMatchObject({ animation: 'Stand', fps: 30 });
    expect(stand!.clip.frames).toBeGreaterThan(30);
    // An MP4 starts with its file-type box, then (fast start) the index before the pictures.
    const video = await readFile(join(dir, 'stand.mp4'));
    expect(video.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(video.indexOf('moov')).toBeLessThan(video.indexOf('mdat'));
    expect(video.includes('avc1')).toBe(true);
    // With a sound track (silent), as sites that take video expect.
    expect(video.includes('mp4a')).toBe(true);

    expect(dance!.clip).toMatchObject({ animation: 'EmoteDance', fps: 25 });
    const gif = await readFile(join(dir, 'dance.gif'));
    expect(gif.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect([gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual([320, 240]);

    expect(frames!.clip.frames).toBe(2);
    const zipped = unzipSync(new Uint8Array(await readFile(join(dir, 'frames.zip'))));
    expect(Object.keys(zipped)).toEqual(['frame-0001.png', 'frame-0002.png']);
    const frame = decodePng(zipped['frame-0001.png']!);
    expect([frame.width, frame.height]).toEqual([200, 250]);
    // Transparent around the character, and the character is there.
    expect(frame.pixels[3]).toBe(0);
    expect(alphaBounds(frame)!.height).toBeGreaterThan(150);

    // Standing on Stormwind's gate bridge: the game's height for it, props around, and a picture filled to its corners.
    expect(placed!.problems).toEqual([]);
    expect(placed!.place.ground[2]).toBeCloseTo(93.3, 0);
    expect(placed!.place.props).toBeGreaterThan(100);
    const there = decodePng(new Uint8Array(await readFile(join(dir, 'place.png'))));
    expect([there.width, there.height]).toEqual([640, 360]);
    expect(there.pixels[3]).toBe(255);
    expect(there.pixels[there.pixels.length - 1]).toBe(255);

    expect(wrongName!.error).toMatch(/saved as .mp4, .gif or .zip/);
    expect(noClip!.error).toMatch(/add "clip": true/);

    // A camera that turns: the same pose seen from two sides.
    expect(turn!.clip.frames).toBe(4);
    const turned = unzipSync(new Uint8Array(await readFile(join(dir, 'turn.zip'))));
    expect(Buffer.from(turned['frame-0001.png']!).equals(Buffer.from(turned['frame-0004.png']!))).toBe(false);

    // A looped length is whole passes: one pass at least, however short the length asked for.
    expect(looped!.clip.frames).toBeGreaterThan(1);

    // The same place with nobody in it: a full picture that differs from the one with the dwarf.
    expect(nobody!.problems).toEqual([]);
    const vacant = decodePng(new Uint8Array(await readFile(join(dir, 'nobody.png'))));
    expect(vacant.pixels[3]).toBe(255);
    expect(Buffer.from(vacant.pixels).equals(Buffer.from(there.pixels))).toBe(false);
  }, 240_000);
});
