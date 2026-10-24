import { beforeAll, describe, expect, it } from 'vitest';
import { CascStorage } from '../../src/casc/storage';
import { Equipment } from '../../src/character/equipment';
import { FIGHT_SOUND_NAMES, type FightSoundName, type FightSoundSet, loadFightSounds, soundFormat, Sounds } from '../../src/character/sounds';
import { Database } from '../../src/db2/database';
import { Definitions } from '../../src/db2/definitions';
import { cachedFetch } from '../cached-fetch';
import { hasClient, NodeSource, WOW_DIR } from '../node-source';

/** The sounds every race and sex must have a kit for. */
const VOICE: FightSoundName[] = ['exert', 'injury', 'injuryCrit', 'death', 'roar'];
const WEAPON: FightSoundName[] = ['swing', 'swingCrit', 'hit', 'crit', 'block'];

// Needs a game install. Reported as skipped, not passed, when there is none.
describe.skipIf(!hasClient)('fight sounds in the install', () => {
  let storage: CascStorage;
  let sounds: Sounds;
  let equipment: Equipment;

  beforeAll(async () => {
    storage = await CascStorage.open(new NodeSource(WOW_DIR));
    const database = new Database(
      storage,
      new Definitions(async (url) => {
        const text = await cachedFetch(url, `dbd/${url.split('/').pop()}`);
        if (text === undefined) throw new Error(`Could not fetch ${url}`);
        return text;
      }),
    );
    [sounds, equipment] = await Promise.all([Sounds.load(database), Equipment.load(database)]);
    console.log(`${storage.info.product} ${storage.info.version}`);
  }, 120_000);

  it('finds every sound of a human male warrior with a two-handed sword, as OGG files', { timeout: 60_000 }, async () => {
    const set = await loadFightSounds(storage, sounds, { raceId: 1, sex: 0, classId: 1, weaponSubclass: 8 });
    console.log(describe_(set));
    for (const name of FIGHT_SOUND_NAMES) expect(set.sounds[name], name).toBeGreaterThan(0);
    expect(set.problems).toEqual([]);
    for (const kit of Object.values(set.kits)) {
      expect(kit.clips.length).toBeGreaterThan(0);
      for (const clip of kit.clips) {
        expect(clip.format).toBe('ogg');
        expect(soundFormat(clip.bytes)).toBe('ogg');
        expect(clip.bytes.length).toBeGreaterThan(1000);
        expect(clip.volume).toBeGreaterThan(0);
        expect(clip.volume).toBeLessThanOrEqual(1);
      }
    }
    // Known kits of the classic data: the small-weapon swing is a one-handed sound, the big one is this sword's.
    expect(set.sounds.swing).not.toBe(sounds.choose({ raceId: 1, sex: 0, weaponSubclass: 7 }).sounds.swing);
    expect(set.sounds.gong).toBe(4654);
  });

  it('gives each class its own spell, with a cast and an impact', () => {
    const picks = new Map<number, string>();
    for (const classId of [1, 2, 3, 4, 5, 7, 8, 9, 11]) {
      const { sounds: chosen, problems } = sounds.choose({ raceId: 1, sex: 0, classId });
      picks.set(classId, `${chosen.cast ?? '-'}/${chosen.impact ?? '-'}${problems.length ? ` (${problems.join(', ')})` : ''}`);
    }
    console.log('spells by class (cast/impact):', [...picks].map(([c, s]) => `${c}=${s}`).join(' '));
    for (const [classId, pick] of picks) expect(pick, `class ${classId}`).toMatch(/^\d+\/\d+$/);
    // A mage's Fireball and a warlock's Shadow Bolt do not sound the same.
    expect(picks.get(8)).not.toBe(picks.get(9));
  });

  it('has a voice for both sexes of the eight classic races and weapon sounds for every subclass', () => {
    const missing: string[] = [];
    for (const raceId of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const sex of [0, 1]) {
        const { sounds: chosen } = sounds.choose({ raceId, sex, wielding: 'unarmed' });
        for (const name of VOICE) if (!chosen[name]) missing.push(`race ${raceId} sex ${sex} ${name}`);
      }
    }
    for (const subclass of [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18]) {
      const { sounds: chosen } = sounds.choose({ raceId: 1, sex: 0, weaponSubclass: subclass });
      for (const name of WEAPON) if (!chosen[name]) missing.push(`subclass ${subclass} ${name}`);
    }
    expect(missing).toEqual([]);
  });

  it('takes the weapon subclass from a worn item', () => {
    const staff = equipment.search('mainHand', 'Staff').items.find((item) => /^Staff of /.test(item.name) || /Staff$/.test(item.name));
    expect(staff).toBeDefined();
    expect(equipment.weaponSubclass(staff!.id)).toBe(10);
    expect(equipment.weaponSubclass(0x7fffffff)).toBeUndefined();
  });
});

function describe_(set: FightSoundSet): string {
  return [
    `chosen in ${set.ms.toFixed(0)} ms` + (set.problems.length ? `; problems: ${set.problems.join('; ')}` : ''),
    ...FIGHT_SOUND_NAMES.map((name) => {
      const kit = set.sounds[name] === undefined ? undefined : set.kits[set.sounds[name]!];
      return `  ${name}: kit ${set.sounds[name] ?? '-'} ${kit ? kit.clips.map((c) => `${c.fileId} (${c.format}, ${c.bytes.length} B, vol ${c.volume.toFixed(2)})`).join(', ') : ''}`;
    }),
  ].join('\n');
}
