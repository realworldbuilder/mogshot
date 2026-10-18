import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { SLOTS, type Slot } from '../src/character/equipment';
import { buildCreatureScene } from '../src/character/creature-scene';
import { buildCharacterScene, type CharacterRig, type CharacterScene } from '../src/character/scene';
import { CLIP_FORMATS, clipTimes, loopedTimes } from '../src/render/clip';
import { buildPlace } from '../src/world/place';
import { capturedAgo } from '../src/import/record';
import { GRADIENTS } from '../src/render/backdrop';
import { Darkroom } from './browser';
import type { Job } from './job';
import { Session } from './session';
import { remoteFolder, SshSource } from './ssh-source';
import { listProducts } from '../src/casc/storage';
import { NodeSource } from '../src/io/node-source';
import { byName, classOf, offered, raceOf, resolveSpec, sexOf, SIZES, type Shot, type Spec, type World } from './spec';
import { exportGlb } from './gltf';
import { pack } from './wire';

const HELP = `Mogshot from the command line: World of Warcraft characters as PNG files and looping clips.

  mogshot render <spec.json | ->       draw the spec, or each spec of an array; "-" reads standard input
  mogshot export <spec.json>           the spec's character as a glTF binary (.glb) for Blender: meshes, textures,
                                       skeleton and animations. Same spec; "out" ends .glb, "animations" names the
                                       animations to bake (a list, or "all"; default the pose's own and Stand), "fps" 30
  mogshot races                      races, their sexes and classes
  mogshot options <race> <sex>         appearance options and their choices
  mogshot poses <race> <sex>           curated poses, and every animation the model has; or poses npc <display id>
  mogshot npcs [words]                 NPCs the game can name whose name has the words, with their display ids
  mogshot items <slot> [words]         items for a slot whose name has the words
  mogshot sets <class>                 the class's sets, best first, with the weapons that go with each
  mogshot backdrops                    gradients and loading screens
  mogshot sizes                        the sizes that have names
  mogshot characters                   characters the Mogshot addon saved in the game folder
  mogshot products                     the games installed in the folder, with their versions

  --wow <folder>     the game folder (or WOW_DIR; default /Applications/World of Warcraft); host:/folder reads
                     one on another computer through ssh, e.g. williams-macbook-pro-2:/Applications/World of Warcraft
  --product <name>   which of the folder's games to read (or WOW_PRODUCT): wow is retail, wow_classic_beta the
                     classic beta; default the first active one in .build.info. mogshot products lists them

Everything is printed as JSON. A spec, with every field but a race, a character or an npc optional:

  {
    "out": "hunter.png",                          relative to the spec file
    "character": "Rambleon",                      a saved character or a pasted MOG code, as the starting point
    "race": "Night Elf", "sex": "female",
    "npc": 7274,                                  a creature display id, or an NPC's name where the game knows it (mogshot npcs);
                                                  drawn as the game draws it, so leave out race, sex and character. "gear" and
                                                  "set" replace its gear slot by slot, "choices" its look; a creature with a
                                                  model of its own (a beast, a pet) has none of those
    "choices": { "Hair Style": 4, "Face": "…" },  option -> choice by place in the list (from 1), name, or {"id": n}
    "set": { "class": "Hunter", "name": "Giantstalker" },   without a name, the class's best set
    "gear": { "head": 16939, "mainHand": "Rhok'delar", "back": null },   id, name, or null to leave empty
    "pose": "Ready",                              or { "animation": "EmoteDance", "at": 0.5 }
    "clip": true,                                 a looping clip of the pose's animation instead of a picture; "out" ends
                                                  .mp4, .gif or .zip (transparent PNG frames). Or { "animation": "EmoteDance",
                                                  "seconds": 10, "fps": 30 }; without seconds, one pass, which loops cleanly.
                                                  "loop": true rounds the seconds to whole passes, so that loops too.
                                                  "to": { "yaw": 60, "zoom": 0.8 } moves the camera there over the clip
                                                  "size": "reel" makes it 1080 × 1920
    "place": { "x": -8833, "y": 628, "facing": 215 },   stand in the game world, at the position /mogshot spot prints in the game;
                                                  also "map" (name or number, default Eastern Kingdoms), "z" to pick a floor,
                                                  "reach" in yards (default 300). Fills the frame; default size "1080p".
                                                  "empty": true draws the place with nobody in it
    "camera": { "yaw": 25, "pitch": 5, "zoom": 1.2, "fov": 30, "panX": 0, "panY": 0 },   degrees
    "size": "square",                             or { "width": 1080, "height": 1350, "tight": false }; default "tight" (a clip: "square", at 1080)
    "title": "Rambleon",                          words over the picture or the clip; or { "text": "Rambleon",
                                                  "sub": "Level 60 Warrior", "at": "bottom" } for a smaller second line
                                                  and the bottom in place of the top. Not on a tight crop
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
  let product = process.env.WOW_PRODUCT || undefined;
  const productFlag = args.indexOf('--product');
  if (productFlag >= 0) {
    const [, name] = args.splice(productFlag, 2);
    if (!name) throw new Error('--product needs a name, e.g. wow or wow_classic_beta');
    product = name;
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
  if (!remoteFolder(wow) && !existsSync(join(wow, '.build.info'))) throw new Error(`${wow} is not a World of Warcraft folder. Pass --wow <folder> or set WOW_DIR.`);
  if (command === 'products') {
    const remote = remoteFolder(wow);
    const source = remote ? new SshSource(remote.host, remote.root) : new NodeSource(wow);
    print((await listProducts(source)).map((entry) => ({ product: entry.product, version: entry.version, active: entry.active })));
    return 0;
  }
  const session = await Session.open(wow, join(host.root, 'node_modules', '.cache', 'mogshot', 'cli'), product);

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
      if (rest[0] === 'npc') {
        if (!/^\d+$/.test(rest[1] ?? '')) throw new Error('Usage: mogshot poses npc <display id>');
        const world = await worldOf(session);
        const shot = resolveSpec({ npc: Number(rest[1]) }, world);
        const { scene } = await build(shot, session, world);
        print({ poses: scene.presets.map((p) => p.name), animations: [...new Set(scene.animations.map((a) => a.name))] });
        return 0;
      }
      const { appearance, race, sex } = await modelOf();
      const { scene } = await buildCharacterScene(session.storage, appearance, undefined, { raceId: race.id, sex });
      print({ poses: scene.presets.map((p) => p.name), animations: [...new Set(scene.animations.map((a) => a.name))] });
      return 0;
    }
    case 'npcs': {
      const [creatures, seen] = await Promise.all([session.creatures(), session.creatureCache()]);
      const words = rest.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
      const known = creatures.creatures.map((c) => ({ id: c.id, name: c.name, title: c.title, displays: c.displays, source: 'game' as const }));
      const ids = new Set(known.map((c) => c.id));
      const list = [
        ...known,
        ...seen.entries
          .filter((entry) => !ids.has(entry.id))
          .map((entry) => ({ id: entry.id, name: entry.name, title: entry.title, displays: entry.displays.map(({ id, scale }) => ({ id, scale })), source: 'seen' as const })),
      ].filter((npc) => words.every((word) => npc.name.toLowerCase().includes(word)));
      print({
        total: list.length,
        npcs: list.slice(0, 60),
        ...(seen.notes.length > 0 && { notes: seen.notes }),
        ...(list.length === 0 && {
          hint: 'Names come from the game files\' pets list and from NPCs this computer has seen in the game: stand near the NPC once with the game running, or give its display id',
        }),
      });
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
    case 'export':
      return exportCommand(rest[0], session);
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

  const world = await worldOf(session);

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
        const place = shot.place && (await buildPlace(session.storage, shot.place));
        const screen = shot.backdrop.kind === 'screen' ? await session.image(shot.backdrop.fileId) : undefined;
        if (shot.backdrop.kind === 'screen' && !screen) throw new Error('The loading screen could not be read');
        const job: Job = {
          scene, camera: shot.camera, ...shot.size, backdrop: shot.backdrop, screen, classicScreen: shot.classicScreen,
          place,
          empty: shot.empty,
          title: shot.title,
          clip: clip && { format: clip.format, fps: clip.fps, framing: clip.framing, poses: clip.poses, cameraTo: clip.cameraTo },
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
          ...(shot.npc && { npc: { id: shot.npc.displayId, name: shot.npc.name, title: shot.npc.title, creature: shot.npc.creatureId, scale: shot.npc.scale } }),
          // An NPC can be built on a race no player can be; a creature of its own kind has none.
          ...(shot.raceId !== undefined && { race: world.appearance.races.find((r) => r.id === shot.raceId)?.name ?? `Race ${shot.raceId}` }),
          ...(shot.sex !== undefined && { sex: sexName(shot.sex) }),
          pose: scene.pose.preset ?? scene.animations.find((a) => a.sequence === scene.pose.sequence)?.name,
          gear: Object.fromEntries([
            ...[...shot.gear].map(([slot, item]) => [slot, `${item.name} (${item.id})`]),
            ...[...shot.wear].map(([slot, displayId]) => [slot, `Display ${displayId}`]),
          ]),
          ...(place && { place: { ground: place.ground.map((n) => Number(n.toFixed(2))), ground_tiles: place.terrain.length, parts: place.meshes.length, props: place.instances.length, propKinds: place.props.length } }),
          problems: [...shot.problems, ...scene.problems, ...(place?.problems ?? []), ...drawn.problems],
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

/** A spec with the two fields an export adds to a shot. */
type ExportSpec = Spec & { animations?: string[] | 'all'; fps?: number };

async function exportCommand(file: string | undefined, session: Session): Promise<number> {
  if (!file) throw new Error('Usage: mogshot export <spec.json>');
  const text = await readFile(file, 'utf8');
  let parsed: ExportSpec | ExportSpec[];
  try {
    parsed = JSON.parse(text) as ExportSpec | ExportSpec[];
  } catch (cause) {
    throw new Error(`${file} is not JSON: ${messageOf(cause)}`);
  }
  const specs = Array.isArray(parsed) ? parsed : [parsed];
  const base = dirname(resolve(file));
  const world = await worldOf(session);
  let failed = 0;
  const files: unknown[] = [];
  for (const [index, { animations: wanted, fps = 30, ...spec }] of specs.entries()) {
    const out = resolve(base, spec.out ?? `mogshot-${index + 1}.glb`);
    const start = performance.now();
    try {
      if (!out.endsWith('.glb')) throw new Error('An export\'s "out" ends .glb');
      const shot = resolveSpec(spec, world);
      const { scene, rig } = await build(shot, session, world);
      // Animations are baked by sequence, so a name that has variations bakes each of them.
      const posed = scene.animations.find((a) => a.sequence === scene.pose.sequence);
      const chosen =
        wanted === 'all'
          ? scene.animations
          : wanted
            ? wanted.flatMap((name) => {
                const all = scene.animations.filter((a) => a.name.toLowerCase() === name.toLowerCase());
                if (all.length === 0) byName(scene.animations, name, 'animation', (a) => a.name); // throws with the list
                return all.length > 0 ? [all[0]!] : [];
              })
            : [...new Map([posed, scene.animations.find((a) => a.name === 'Stand')].filter((a): a is NonNullable<typeof a> => a !== undefined).map((a) => [a.sequence, a])).values()];
      const name = shot.npc?.name ?? [world.appearance.races.find((r) => r.id === shot.raceId)?.name, shot.sex !== undefined && sexName(shot.sex)].filter(Boolean).join(' ') ?? 'character';
      const { glb, report } = await exportGlb(scene, rig, { name, animations: chosen, fps });
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, glb);
      files.push({
        out,
        bytes: glb.byteLength,
        ...report,
        seconds: Number(((performance.now() - start) / 1000).toFixed(1)),
        problems: [...shot.problems, ...scene.problems],
      });
    } catch (cause) {
      failed++;
      files.push({ out, error: messageOf(cause) });
    }
  }
  print(files);
  return failed > 0 ? 1 : 0;
}

/** Everything a spec's names are placed against. */
async function worldOf(session: Session): Promise<World> {
  const [appearance, equipment, classes, screens, records, maps, creatures, seen] = await Promise.all([
    session.appearance(), session.equipment(), session.classes(), session.screens(), session.records(), session.maps(), session.creatures(), session.creatureCache(),
  ]);
  return { appearance, equipment, classes, screens, records, maps, creatures, seen, installed: (fileId) => session.storage.files.find(fileId) !== undefined };
}

/** Build the shot's character, or creature, in its pose. */
async function build(shot: Shot, session: Session, world: World): Promise<{ scene: CharacterScene; rig: CharacterRig }> {
  const { scene, rig } =
    shot.creature || shot.raceId === undefined || shot.sex === undefined
      ? await buildCreatureScene(session.storage, { modelFileId: shot.creature!.fileId, textures: shot.creature!.textures, scale: shot.creature!.scale }, { pose: shot.pose })
      : await buildCharacterScene(session.storage, world.appearance, world.equipment, {
          raceId: shot.raceId,
          sex: shot.sex,
          choices: shot.choices,
          gear: new Map([...shot.gear].map(([slot, item]) => [slot, item.id])),
          looks: new Map([...shot.gear].flatMap(([slot, item]) => (item.displayId ? [[slot, item.displayId] as const] : []))),
          wear: shot.wear,
          bake: shot.bake,
          scale: shot.npc?.scale,
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
  const times = clip.loop && clip.seconds !== undefined ? loopedTimes(animation.duration, clip.fps, clip.seconds) : clipTimes(animation.duration, clip.fps, clip.seconds);
  for (const time of times) poses.push((await rig.pose(animation.sequence, time)).meshes);
  // The camera stays framed on the animation's first moment.
  const framing = (await rig.pose(animation.sequence, 0)).bounds;
  return { ...clip, animation: animation.name, framing, poses };
}
