import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { SLOTS, type Slot } from '../src/character/equipment';
import { buildCharacterScene, type CharacterRig, type CharacterScene } from '../src/character/scene';
import { CLIP_FORMATS, clipTimes } from '../src/render/clip';
import { capturedAgo } from '../src/import/record';
import { GRADIENTS } from '../src/render/backdrop';
import { Darkroom } from './browser';
import type { Job } from './job';
import { Session } from './session';
import { byName, classOf, offered, raceOf, resolveSpec, sexOf, SIZES, type Shot, type Spec, type World } from './spec';
import { pack } from './wire';

const HELP = `Mogshot from the command line: World of Warcraft characters as PNG files and looping clips.

  mogshot render <spec.json | ->       draw the spec, or each spec of an array; "-" reads standard input
  mogshot races                        races, their sexes and classes
  mogshot options <race> <sex>         appearance options and their choices
  mogshot poses <race> <sex>           curated poses, and every animation the model has
  mogshot items <slot> [words]         items for a slot whose name has the words
  mogshot sets <class>                 the class's sets, best first, with the weapons that go with each
  mogshot backdrops                    gradients and loading screens
  mogshot sizes                        the sizes that have names
  mogshot characters                   characters the Mogshot addon saved in the game folder

  --wow <folder>   the game folder (or WOW_DIR; default /Applications/World of Warcraft)

Everything is printed as JSON. A spec, with every field but a race or a character optional:

  {
    "out": "hunter.png",                          relative to the spec file
    "character": "Rambleon",                      a saved character or a pasted MOG code, as the starting point
    "race": "Night Elf", "sex": "female",
    "choices": { "Hair Style": 4, "Face": "…" },  option -> choice by place in the list (from 1), name, or {"id": n}
    "set": { "class": "Hunter", "name": "Giantstalker" },   without a name, the class's best set
    "gear": { "head": 16939, "mainHand": "Rhok'delar", "back": null },   id, name, or null to leave empty
    "pose": "Ready",                              or { "animation": "EmoteDance", "at": 0.5 }
    "clip": true,                                 a looping clip of the pose's animation instead of a picture; "out" ends
                                                  .mp4, .gif or .zip (transparent PNG frames). Or { "animation": "EmoteDance",
                                                  "seconds": 4, "fps": 30 }; without seconds, one pass, which loops cleanly
    "camera": { "yaw": 25, "pitch": 5, "zoom": 1.2, "fov": 30, "panX": 0, "panY": 0 },   degrees
    "size": "square",                             or { "width": 1080, "height": 1350, "tight": false }; default "tight" (a clip: "square", at 1080)
    "backdrop": "Frost"                           a gradient, "#1c1f26", { "screen": "Teldrassil", "blur": 8, "vignette": 0.4 },
  }                                               { "gradient": {"from","to"}, "shape": "vertical" }; default none (transparent)

Each picture is reported with its problems (things that could not be drawn). Look at the PNG before using it.
Slots: ${SLOTS.map((s) => s.id).join(', ')}.`;

export interface Host {
  /** The Mogshot folder. */
  root: string;
  /** Starts serving the drawing page and gives its address. */
  harness: () => Promise<string>;
}

/** JSON on standard output; a list goes one entry to a line. */
const print = (value: unknown) =>
  console.log(Array.isArray(value) ? `[\n${value.map((entry) => `  ${JSON.stringify(entry)}`).join(',\n')}\n]` : JSON.stringify(value, null, 2));
const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const sexName = (sex: number) => (sex === 1 ? 'female' : 'male');

export async function run(argv: string[], host: Host): Promise<number> {
  const args = [...argv];
  let wow = process.env.WOW_DIR ?? '/Applications/World of Warcraft';
  const flag = args.indexOf('--wow');
  if (flag >= 0) {
    const [, dir] = args.splice(flag, 2);
    if (!dir) throw new Error('--wow needs a folder');
    wow = dir;
  }
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return 0;
  }
  if (command === 'sizes') {
    print(SIZES);
    return 0;
  }
  if (!existsSync(join(wow, '.build.info'))) throw new Error(`${wow} is not a World of Warcraft folder. Pass --wow <folder> or set WOW_DIR.`);
  const session = await Session.open(wow, join(host.root, 'node_modules', '.cache', 'mogshot', 'cli'));

  /** The model named by `<race> <sex>` arguments. */
  const modelOf = async () => {
    const [raceName, sexWord] = rest;
    if (!raceName || !sexWord) throw new Error(`Usage: mogshot ${command} <race> <male|female>`);
    const appearance = await session.appearance();
    const race = raceOf(appearance, /^\d+$/.test(raceName) ? Number(raceName) : raceName);
    const sex = sexOf(sexWord as Spec['sex']);
    const model = appearance.model(race.id, sex);
    if (!model) throw new Error(`${race.name} has no ${sexName(sex)} model in this build`);
    return { appearance, race, sex, model };
  };

  switch (command) {
    case 'races': {
      const [appearance, equipment] = await Promise.all([session.appearance(), session.equipment()]);
      print(appearance.races.map((race) => ({ id: race.id, name: race.name, sexes: race.sexes.map(sexName), classes: equipment.classes(race.id).map((c) => c.name) })));
      return 0;
    }
    case 'options': {
      const { appearance, model } = await modelOf();
      print(
        offered(appearance.options(model.chrModelId)).map((option) => ({
          option: option.name,
          // Named choices are listed in order; where the game has no names, only how many there are.
          choices: option.choices.some((c) => c.name) ? option.choices.map((c) => c.name) : option.choices.length,
          ...(option.choices.some((c) => c.swatches.length > 0) ? { colours: option.choices.map((c) => c.swatches.join(' ')) } : {}),
        })),
      );
      return 0;
    }
    case 'poses': {
      const { appearance, race, sex } = await modelOf();
      const { scene } = await buildCharacterScene(session.storage, appearance, undefined, { raceId: race.id, sex });
      print({ poses: scene.presets.map((p) => p.name), animations: [...new Set(scene.animations.map((a) => a.name))] });
      return 0;
    }
    case 'items': {
      const [slot, ...words] = rest;
      if (!SLOTS.some((s) => s.id === slot)) throw new Error(`Usage: mogshot items <slot> [words]. The slots are: ${SLOTS.map((s) => s.id).join(', ')}`);
      const { items, total } = (await session.equipment()).search(slot as Slot, words.join(' '), 60);
      print({ total, items: items.map(({ id, name, quality }) => ({ id, name, quality })) });
      return 0;
    }
    case 'sets': {
      if (!rest[0]) throw new Error('Usage: mogshot sets <class>');
      const info = classOf(await session.classes(), /^\d+$/.test(rest[0]) ? Number(rest[0]) : rest.join(' '));
      const named = (list: [Slot, { id: number; name: string }][]) => Object.fromEntries(list.map(([slot, item]) => [slot, `${item.name} (${item.id})`]));
      print((await session.equipment()).sets(info.id).map((set) => ({ name: set.name, level: set.level, pieces: named(set.pieces), weapons: named(set.weapons) })));
      return 0;
    }
    case 'backdrops': {
      print({ gradients: GRADIENTS.map((g) => g.name), screens: (await session.screens()).map((s) => ({ name: s.name, fileId: s.fileId, wide: s.wide })) });
      return 0;
    }
    case 'characters': {
      const [appearance, records] = await Promise.all([session.appearance(), session.records()]);
      print(
        records.map((record) => ({
          character: record.key,
          race: appearance.races.find((r) => r.id === record.raceId)?.name ?? record.race,
          sex: sexName(record.sex),
          class: record.className,
          items: Object.keys(record.gear).length,
          appearance: record.choices.length > 0 ? 'captured' : 'not captured (visit a barber with the addon on)',
          captured: capturedAgo(record.captured),
        })),
      );
      return 0;
    }
    case 'render':
      return render(rest[0], session, host);
    default:
      throw new Error(`There is no command "${command}". Run mogshot help.`);
  }
}

async function render(file: string | undefined, session: Session, host: Host): Promise<number> {
  if (!file) throw new Error('Usage: mogshot render <spec.json | ->');
  const text = file === '-' ? await new Response(process.stdin as unknown as BodyInit).text() : await readFile(file, 'utf8');
  let parsed: Spec | Spec[];
  try {
    parsed = JSON.parse(text) as Spec | Spec[];
  } catch (cause) {
    throw new Error(`${file === '-' ? 'The spec' : file} is not JSON: ${messageOf(cause)}`);
  }
  const specs = Array.isArray(parsed) ? parsed : [parsed];
  const base = file === '-' ? process.cwd() : dirname(resolve(file));

  const [appearance, equipment, classes, screens, records] = await Promise.all([
    session.appearance(), session.equipment(), session.classes(), session.screens(), session.records(),
  ]);
  const world: World = { appearance, equipment, classes, screens, records };

  let room: Darkroom | undefined;
  let failed = 0;
  const pictures: unknown[] = [];
  try {
    for (const [index, spec] of specs.entries()) {
      const out = resolve(base, spec.out ?? `mogshot-${index + 1}.${spec.clip ? 'mp4' : 'png'}`);
      const start = performance.now();
      try {
        const shot = resolveSpec(spec, world);
        const { scene, rig } = await build(shot, session, world);
        const clip = shot.clip && (await film(shot.clip, scene, rig));
        const screen = shot.backdrop.kind === 'screen' ? await session.image(shot.backdrop.fileId) : undefined;
        if (shot.backdrop.kind === 'screen' && !screen) throw new Error('The loading screen could not be read');
        const job: Job = {
          scene, camera: shot.camera, ...shot.size, backdrop: shot.backdrop, screen, classicScreen: shot.classicScreen,
          clip: clip && { format: clip.format, fps: clip.fps, framing: clip.framing, poses: clip.poses },
        };
        room ??= await Darkroom.open(await host.harness());
        const drawn = await room.shoot(pack(job));
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, drawn.file);
        pictures.push({
          out,
          width: drawn.width,
          height: drawn.height,
          ...(clip && { clip: { kind: CLIP_FORMATS[clip.format].name, animation: clip.animation, frames: clip.poses.length, fps: clip.fps, length: Number((clip.poses.length / clip.fps).toFixed(2)) } }),
          seconds: Number(((performance.now() - start) / 1000).toFixed(1)),
          race: raceOf(appearance, shot.raceId).name,
          sex: sexName(shot.sex),
          pose: scene.pose.preset ?? scene.animations.find((a) => a.sequence === scene.pose.sequence)?.name,
          gear: Object.fromEntries([...shot.gear].map(([slot, item]) => [slot, `${item.name} (${item.id})`])),
          problems: [...shot.problems, ...scene.problems, ...drawn.problems],
          notes: shot.notes,
          graphics: drawn.graphics,
        });
      } catch (cause) {
        failed++;
        pictures.push({ out, error: messageOf(cause) });
      }
    }
  } finally {
    await room?.close();
  }
  print(pictures);
  return failed > 0 ? 1 : 0;
}

/** Build the shot's character in its pose. */
async function build(shot: Shot, session: Session, world: World): Promise<{ scene: CharacterScene; rig: CharacterRig }> {
  const { scene, rig } = await buildCharacterScene(session.storage, world.appearance, world.equipment, {
    raceId: shot.raceId,
    sex: shot.sex,
    choices: shot.choices,
    gear: new Map([...shot.gear].map(([slot, item]) => [slot, item.id])),
    pose: shot.pose,
  });
  // The scene falls back to Stand for a pose the model cannot strike; a picture in the wrong pose is not what was asked for.
  if ('preset' in shot.pose && scene.pose.preset !== shot.pose.preset) {
    throw new Error(`There is no pose called "${shot.pose.preset}" for this character. The poses are: ${scene.presets.map((p) => p.name).join(', ')}`);
  }
  if ('animationId' in shot.pose && !scene.animations.some((a) => a.sequence === scene.pose.sequence && a.id === (shot.pose as { animationId: number }).animationId)) {
    throw new Error(`This character has no animation ${shot.pose.animationId} that can be played`);
  }
  if (shot.animation) {
    const animation = byName(scene.animations, shot.animation.name, 'animation', (a) => a.name);
    const posed = await rig.pose(animation.sequence, Math.min(1, Math.max(0, shot.animation.at)) * animation.duration);
    scene.meshes.forEach((mesh, i) => {
      mesh.bones = posed.meshes[i]!.bones;
      mesh.transform = posed.meshes[i]!.transform;
    });
    scene.bounds = posed.bounds;
    scene.pose = posed.pose;
  }
  return { scene, rig };
}

/** The poses of a clip's frames: the named animation, or the one the scene is posed in. */
async function film(clip: NonNullable<Shot['clip']>, scene: CharacterScene, rig: CharacterRig) {
  const animation = clip.animation
    ? byName(scene.animations, clip.animation, 'animation', (a) => a.name)
    : scene.animations.find((a) => a.sequence === scene.pose.sequence);
  if (!animation) throw new Error('This character is in its rest pose, which has no animation to film');
  const poses = [];
  for (const time of clipTimes(animation.duration, clip.fps, clip.seconds)) poses.push((await rig.pose(animation.sequence, time)).meshes);
  // The camera stays framed on the animation's first moment.
  const framing = (await rig.pose(animation.sequence, 0)).bounds;
  return { ...clip, animation: animation.name, framing, poses };
}
