import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { crc32, deflateSync, gzipSync } from 'node:zlib';
import { SLOTS, type Slot } from '../src/character/equipment';
import { EXPANSIONS, type SetKind, type TransmogSetInfo } from '../src/character/transmog';
import { GRADIENTS } from '../src/render/backdrop';
import { Darkroom } from './browser';
import { build, film, type Host, shoot, worldOf } from './main';
import { Session } from './session';
import { classOf, offered, raceOf, resolveSpec, type Spec, type World } from './spec';
import { pack } from './wire';

/*
 * Transmogify: a page for dressing retail characters, served from this computer. The catalog
 * of transmog sets and items on the left, the character in the middle, and a composer on the
 * right that turns a request in words into Mogshot specs (headless `claude -p`). Pictures are
 * drawn the command line's way, one at a time, in one Chrome kept open.
 */

const PORT = Number(process.env.TRANSMOGIFY_PORT ?? 4190);
/** Where it listens: here, and the tailnet address so the phone can open it. */
const HOSTS = (process.env.TRANSMOGIFY_HOSTS ?? '127.0.0.1,100.76.214.19').split(',').filter(Boolean);
const WOW = process.env.WOW_DIR ?? 'williams-macbook-pro-2:/Applications/World of Warcraft';
const PRODUCT = process.env.WOW_PRODUCT ?? 'wow';
const CLAUDE = process.env.CLAUDE_BIN ?? join(homedir(), '.local/bin/claude');
const COMPOSER_MODEL = process.env.TRANSMOGIFY_MODEL ?? 'sonnet';
/** Saved pictures go where the review app serves them. */
const SAVE_DIR = process.env.TRANSMOGIFY_SAVE ?? join(homedir(), 'projects/wow-forever-guide/content/images/retail/transmogify');
const SAVE_URL = process.env.TRANSMOGIFY_SAVE_URL ?? 'http://100.76.214.19:4180/images/retail/transmogify';
/** A preview is drawn smaller than a saved picture. */
const PREVIEW = { width: 1080, height: 1080 };
const POSES = ['Stand', 'Ready', 'Attack', 'Cast', 'Roar', 'Cheer', 'Point', 'Flex', 'Salute', 'Wave', 'Kneel'];

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

// ---- the game, opened once and kept --------------------------------------------------------

let opening: Promise<{ session: Session; world: World }> | undefined;
let openError: string | undefined;
let openedAt: number | undefined;

function game(): Promise<{ session: Session; world: World }> {
  opening ??= (async () => {
    try {
      const session = await Session.open(WOW, join(root, 'node_modules', '.cache', 'mogshot', 'cli'), PRODUCT);
      const world = await worldOf(session);
      openError = undefined;
      openedAt = Date.now();
      return { session, world };
    } catch (cause) {
      openError = messageOf(cause);
      opening = undefined;
      throw cause;
    }
  })();
  return opening;
}

/** A failure that means the connection to the game folder is gone: open it afresh next time. */
function forgetGameOn(cause: unknown) {
  if (/ssh|connection|closed|EPIPE|ECONNRESET|exited/i.test(messageOf(cause))) opening = undefined;
}

let room: Darkroom | undefined;
let host: Host;
let root: string;
/** Pictures are drawn one at a time. */
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

function drawn<T>(work: () => Promise<T>): Promise<T> {
  waiting++;
  const run = queue.then(work, work);
  queue = run.catch(() => undefined).finally(() => waiting--);
  return run;
}

async function draw(spec: Spec): Promise<{ file: Buffer; report: Record<string, unknown> }> {
  const { session, world } = await game();
  try {
    return await shoot(spec, session, world, async () => (room ??= await Darkroom.open(await host.harness())));
  } catch (cause) {
    if (/Target .*closed|browser has been closed|crashed/i.test(messageOf(cause))) {
      await room?.close().catch(() => undefined);
      room = undefined;
    }
    forgetGameOn(cause);
    throw cause;
  }
}

// ---- pictures -----------------------------------------------------------------------------

const renders = () => join(root, 'node_modules', '.cache', 'transmogify', 'renders');
const hashOf = (value: unknown) => createHash('sha1').update(`${PRODUCT}\u0000${JSON.stringify(value)}`).digest('hex').slice(0, 16);

async function render(spec: Spec): Promise<{ id: string; url: string; report: Record<string, unknown>; cached: boolean }> {
  const wanted: Spec = { ...spec, size: spec.size ?? PREVIEW };
  delete wanted.out;
  const id = hashOf(wanted);
  const file = join(renders(), `${id}.png`);
  const reportFile = join(renders(), `${id}.json`);
  if (existsSync(file) && existsSync(reportFile)) {
    return { id, url: `/renders/${id}.png`, report: JSON.parse(await readFile(reportFile, 'utf8')), cached: true };
  }
  const { file: png, report: drawnReport } = await drawn(() => draw(wanted));
  // What each slot shows, with icons, for the page's slot list.
  const { world } = await game();
  const shot = resolveSpec(wanted, world);
  const report = {
    ...drawnReport,
    slots: Object.fromEntries([...shot.gear].map(([slot, item]) => [slot, { id: item.id, name: item.name, quality: item.quality, icon: item.iconFileId }])),
  };
  await mkdir(renders(), { recursive: true });
  await writeFile(file, png);
  await writeFile(reportFile, JSON.stringify(report));
  return { id, url: `/renders/${id}.png`, report, cached: false };
}

/** The frames a second of the idle loop the page plays. */
const LIVE_FPS = 30;
const lives = () => join(root, 'node_modules', '.cache', 'transmogify', 'live');

/**
 * The character for the page to draw itself and turn by hand, as character select does: the
 * built scene, one pass of its pose's animation, and the backdrop, packed and gzipped. The
 * camera is left out of the key, since turning it is the page's job.
 */
async function live(spec: Spec): Promise<{ id: string; url: string; report: Record<string, unknown>; cached: boolean }> {
  const wanted: Spec = { ...spec };
  for (const key of ['out', 'size', 'clip', 'title', 'camera'] as const) delete wanted[key];
  const id = hashOf({ live: 1, ...wanted });
  const file = join(lives(), `${id}.bin`);
  const reportFile = join(lives(), `${id}.json`);
  if (existsSync(file) && existsSync(reportFile)) {
    return { id, url: `/live/${id}.bin`, report: JSON.parse(await readFile(reportFile, 'utf8')), cached: true };
  }
  const { session, world } = await game();
  const start = performance.now();
  try {
    const shot = resolveSpec({ ...wanted, clip: { fps: LIVE_FPS } }, world);
    const { scene, rig } = await build(shot, session, world);
    // The rest pose has no animation to loop; it is shown still.
    const clip = await film(shot.clip!, scene, rig).catch(() => undefined);
    const screen = shot.backdrop.kind === 'screen' ? await session.image(shot.backdrop.fileId) : undefined;
    const bytes = pack({
      scene,
      poses: clip?.poses ?? [],
      framing: clip?.framing ?? scene.bounds,
      fps: LIVE_FPS,
      backdrop: shot.backdrop,
      screen,
      classicScreen: shot.classicScreen,
    });
    const report = {
      seconds: Number(((performance.now() - start) / 1000).toFixed(1)),
      bytes: bytes.length,
      pose: scene.pose.preset,
      poses: scene.presets.map((p) => p.name),
      frames: clip?.poses.length ?? 0,
      slots: Object.fromEntries([...shot.gear].map(([slot, item]) => [slot, { id: item.id, name: item.name, quality: item.quality, icon: item.iconFileId }])),
      problems: [...shot.problems, ...scene.problems],
      notes: shot.notes,
    };
    await mkdir(lives(), { recursive: true });
    await writeFile(file, gzipSync(bytes, { level: 4 }));
    await writeFile(reportFile, JSON.stringify(report));
    return { id, url: `/live/${id}.bin`, report, cached: false };
  } catch (cause) {
    forgetGameOn(cause);
    throw cause;
  }
}

/** A PNG of RGBA pixels: the item icons. */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const icons = new Map<number, Promise<Buffer | undefined>>();
function icon(fileId: number): Promise<Buffer | undefined> {
  let found = icons.get(fileId);
  if (!found) {
    found = (async () => {
      const cached = join(root, 'node_modules', '.cache', 'transmogify', 'icons', `${fileId}.png`);
      if (existsSync(cached)) return readFile(cached);
      const { session } = await game();
      const image = await session.image(fileId);
      if (!image) return undefined;
      const png = encodePng(image.width, image.height, image.pixels);
      await mkdir(join(cached, '..'), { recursive: true });
      await writeFile(cached, png);
      return png;
    })().catch(() => undefined);
    icons.set(fileId, found);
  }
  return found;
}

// ---- the catalog --------------------------------------------------------------------------

function setJson(set: TransmogSetInfo, world: World) {
  const catalog = world.transmog!;
  const nameOf = (id: number) => world.classes.find((c) => c.id === id)?.name ?? `Class ${id}`;
  return {
    id: set.id,
    name: set.name,
    label: set.label,
    kind: set.kind,
    expansion: set.expansion,
    classes: set.classes.map(nameOf),
    variants: catalog.variants(set.id).map((v) => ({ id: v.id, label: v.label || 'Base' })),
    pieces: set.pieces.map((p) => ({ slot: p.slot, source: p.sourceId, item: p.item.id, name: p.item.name, quality: p.item.quality, icon: p.item.iconFileId })),
  };
}

/** One line a set, for the composer: cheap to read. */
const setLine = (set: TransmogSetInfo, world: World) =>
  `${set.id}\t${set.name}${set.label ? ` [${set.label}]` : ''}\t${set.kind}\t${set.expansion}\t${set.classes.length ? set.classes.map((id) => world.classes.find((c) => c.id === id)?.name).join('/') : 'any class'}\t${set.pieces.map((p) => p.slot).join(',')}`;

async function api(path: string, query: URLSearchParams, body: unknown): Promise<unknown> {
  switch (path) {
    case 'status':
      return { ready: opening !== undefined && openError === undefined && openedAt !== undefined, error: openError, wow: WOW, product: PRODUCT, waiting };
    case 'meta': {
      const { session, world } = await game();
      return {
        build: session.storage.info.version,
        races: world.appearance.races.map((race) => ({
          id: race.id,
          name: race.name,
          sexes: race.sexes.map((s) => (s === 1 ? 'female' : 'male')),
          classes: world.equipment.classes(race.id).map((c) => c.name),
        })),
        classes: world.classes.map((c) => c.name),
        expansions: EXPANSIONS,
        kinds: ['raid', 'pvp', 'heritage', 'dungeon', 'other'],
        slots: SLOTS.map((s) => ({ id: s.id, name: s.name })),
        poses: POSES,
        gradients: GRADIENTS.map((g) => g.name),
        screens: world.screens.filter((s) => s.wide).map((s) => s.name),
      };
    }
    case 'sets': {
      const { world } = await game();
      if (!world.transmog) throw new Error('This build has no transmog sets');
      const className = query.get('class') || undefined;
      const expansion = query.get('expansion') || undefined;
      const { sets, total } = world.transmog.search(
        query.get('q') ?? '',
        {
          classId: className ? classOf(world.classes, className).id : undefined,
          kind: (query.get('kind') || undefined) as SetKind | undefined,
          label: query.get('label') || undefined,
          expansionId: expansion === undefined ? undefined : /^\d+$/.test(expansion) ? Number(expansion) : EXPANSIONS.findIndex((e) => e.toLowerCase().includes(expansion.toLowerCase())),
        },
        query.has('brief') ? Math.min(Number(query.get('limit') ?? 40), 200) : 5000,
      );
      if (query.has('brief')) return `${total} sets\n${sets.map((s) => setLine(s, world)).join('\n')}`;
      // The page shows a set once, its difficulties and colours as buttons on it.
      const roots = new Set<number>();
      const once = sets.filter((s) => {
        const root = s.parentId || s.id;
        if (roots.has(root)) return false;
        roots.add(root);
        return true;
      });
      return { total: once.length, sets: once.slice(0, Math.min(Number(query.get('limit') ?? 40), 200)).map((s) => setJson(s, world)) };
    }
    case 'set': {
      const { world } = await game();
      const set = world.transmog?.get(Number(query.get('id')));
      if (!set) throw new Error(`There is no transmog set ${query.get('id')}`);
      return setJson(set, world);
    }
    case 'items': {
      const { world } = await game();
      const slot = query.get('slot') as Slot;
      if (!SLOTS.some((s) => s.id === slot)) throw new Error(`The slots are ${SLOTS.map((s) => s.id).join(', ')}`);
      const { items, total } = world.equipment.search(slot, query.get('q') ?? '', Math.min(Number(query.get('limit') ?? 40), 200));
      if (query.has('brief')) return `${total} items\n${items.map((i) => `${i.id}\t${i.name}\tquality ${i.quality}`).join('\n')}`;
      return { total, items: items.map((i) => ({ id: i.id, name: i.name, quality: i.quality, icon: i.iconFileId })) };
    }
    case 'options': {
      const { world } = await game();
      const asked = query.get('race') ?? '';
      const race = raceOf(world.appearance, /^\d+$/.test(asked) ? Number(asked) : asked);
      const sex = query.get('sex') === 'female' ? 1 : 0;
      const model = world.appearance.model(race.id, sex);
      if (!model) throw new Error(`${race.name} has no ${query.get('sex')} model`);
      const options = offered(world.appearance.options(model.chrModelId)).map((o) => ({ id: o.id, name: o.name, choices: o.choices.map((c, i) => c.name || `${i + 1}`) }));
      if (query.has('brief')) return options.map((o) => `${o.name}: ${o.choices.length} choices (${o.choices.slice(0, 12).join(', ')}${o.choices.length > 12 ? ', …' : ''})`).join('\n');
      return options;
    }
    case 'check': {
      // Whether a spec's names all place, without drawing it.
      const { world } = await game();
      try {
        const shot = resolveSpec(body as Spec, world);
        return { ok: true, problems: shot.problems, notes: shot.notes };
      } catch (cause) {
        return { ok: false, error: messageOf(cause) };
      }
    }
    case 'render':
      return render((body as { spec: Spec }).spec);
    case 'live':
      return live((body as { spec: Spec }).spec);
    case 'save': {
      const { spec, name } = body as { spec: Spec; name?: string };
      const full: Spec = { ...spec, size: spec.size && typeof spec.size === 'string' ? spec.size : 'square' };
      delete full.out;
      const { file, report } = await drawn(() => draw(full));
      const slug = `${(name || 'look').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'look'}-${hashOf(full).slice(0, 6)}`;
      await mkdir(SAVE_DIR, { recursive: true });
      await writeFile(join(SAVE_DIR, `${slug}.png`), file);
      await writeFile(join(SAVE_DIR, `${slug}.json`), `${JSON.stringify({ ...full, out: `${slug}.png` }, null, 2)}\n`);
      return { file: join(SAVE_DIR, `${slug}.png`), url: `${SAVE_URL}/${slug}.png`, report };
    }
    case 'random':
      return { looks: await randomLooks(body as RandomRequest) };
    case 'compose':
      return compose(body as ComposeRequest);
    case 'compose/status': {
      const job = jobs.get(query.get('id') ?? '');
      if (!job) throw new Error('There is no such composer job');
      return job;
    }
    default:
      throw new NotFound();
  }
}

class NotFound extends Error {}

// ---- random looks -------------------------------------------------------------------------

interface RandomRequest {
  /** A set of the class's, a piece from a different set in each slot, or anyone at all in a set. */
  mode: 'set' | 'mix' | 'anyone';
  race?: number | string;
  sex?: 'male' | 'female';
  cls?: string;
  backdrop?: Spec['backdrop'];
  pose?: string;
  count?: number;
}

const classSets = new Map<number, [Slot, { id: number }][][]>();
const ARMOUR: Slot[] = ['head', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist', 'legs', 'feet'];
const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

async function randomLooks(request: RandomRequest): Promise<{ title: string; cls: string; spec: Spec }[]> {
  const { world } = await game();
  const catalog = world.transmog;
  if (!catalog) throw new Error('This build has no transmog sets');
  const classesOf = (raceId: number) => world.equipment.classes(raceId).filter((c) => c.name !== 'Adventurer');
  const looks = [];
  for (let n = 0; n < Math.min(Math.max(request.count ?? 1, 1), 12); n++) {
    let raceId: number;
    let sex = request.sex ?? 'female';
    let cls = request.cls;
    if (request.mode === 'anyone' || request.race === undefined) {
      const race = pick(world.appearance.races.filter((r) => classesOf(r.id).length > 0))!;
      raceId = race.id;
      sex = pick(race.sexes) === 1 ? 'female' : 'male';
      cls = pick(classesOf(race.id))!.name;
    } else {
      raceId = typeof request.race === 'number' ? request.race : raceOf(world.appearance, request.race).id;
    }
    const info = classOf(world.classes, cls ?? classesOf(raceId)[0]!.name);
    // Sets made for the class, with most of an outfit: no cosmetics any class can wear, no lone pieces.
    const pool = catalog.sets.filter((set) => set.classes.includes(info.id) && set.pieces.length >= 5);
    if (pool.length === 0) throw new Error(`There are no transmog sets for ${info.name}`);
    const spec: Spec = { race: raceId, sex, pose: request.pose ?? 'Stand', backdrop: request.backdrop ?? 'Ember' };
    const gear: NonNullable<Spec['gear']> = {};
    let title: string;
    if (request.mode === 'mix') {
      const used: string[] = [];
      for (const slot of ARMOUR) {
        const set = pick(pool.filter((s) => s.pieces.some((p) => p.slot === slot)));
        const piece = set?.pieces.find((p) => p.slot === slot);
        if (!set || !piece) continue;
        gear[slot] = { source: piece.sourceId };
        if (slot === 'chest' || slot === 'head') used.push(set.name);
      }
      title = `Mix: ${used.join(' + ') || info.name}`;
    } else {
      const set = pick(pool)!;
      spec.set = { id: set.id };
      title = `${set.name}${set.label ? ` (${set.label})` : ''}`;
    }
    // Weapons the class carries, from one of its item sets (each set's are picked to match it, which takes a while: kept).
    if (!classSets.has(info.id)) classSets.set(info.id, world.equipment.sets(info.id).map((set) => set.weapons));
    const weapons = pick(classSets.get(info.id)!) ?? [];
    for (const [slot, item] of weapons) gear[slot] = item.id;
    if (Object.keys(gear).length > 0) spec.gear = gear;
    looks.push({ title, cls: info.name, spec });
  }
  return looks;
}

// ---- the composer -------------------------------------------------------------------------

interface ComposeRequest {
  prompt: string;
  /** The look on the page now, so "make it darker" has something to work on. */
  current?: Spec;
  /** The composer's conversation so far, to carry on. */
  session?: string;
}

interface Look {
  title: string;
  spec: Spec;
  error?: string;
}

interface ComposeJob {
  id: string;
  state: 'working' | 'done' | 'failed';
  /** What it has been doing, a line a step. */
  steps: string[];
  message?: string;
  looks?: Look[];
  session?: string;
  error?: string;
}

const jobs = new Map<string, ComposeJob>();

const LOOKS_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'One or two sentences to William about what you made.' },
    looks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, spec: { type: 'object' } },
        required: ['title', 'spec'],
      },
    },
  },
  required: ['message', 'looks'],
};

async function brief(request: ComposeRequest): Promise<string> {
  const api = `http://127.0.0.1:${PORT}/api`;
  return `You are the composer in Transmogify, a page that renders World of Warcraft retail characters (build from the game files) dressed in transmog. Turn William's request into Mogshot specs, one per look.

Find real sets and items with curl (only these, always with -s and the URL in single quotes):
- curl -s '${api}/sets?brief&q=<words>&class=<Class>&kind=<raid|pvp|heritage|dungeon|other>&expansion=<name>&label=<Mythic|Heroic|Normal|Raid Finder|...>&limit=40'  → id, name [variant], kind, expansion, classes, slots
- curl -s '${api}/items?brief&slot=<slot>&q=<words>'  → item id, name (slots: ${SLOTS.map((s) => s.id).join(', ')})
- curl -s '${api}/options?brief&race=<Race>&sex=<male|female>'  → appearance options and choices
- curl -s -X POST '${api}/check' -H 'content-type: application/json' -d '<spec json>'  → whether a spec places, with its error
Every word of q must be in the set's name; search with one or two distinctive words, and leave q empty to browse by class and expansion.

A spec:
{ "race": "Night Elf", "sex": "female",
  "set": { "id": 5872 },                       a transmog set by id (best) or { "name": "...", "label": "Mythic" }
  "gear": { "mainHand": 19364, "head": null, "shoulder": { "source": 7017 } },   item id, null to empty, or an appearance source
  "choices": { "Hair Color": 3 },              optional, option name -> choice number from 1
  "pose": "Stand",                             ${POSES.join(', ')} (Ready/Attack need a weapon)
  "backdrop": "Ember",                         gradients: ${GRADIENTS.map((g) => g.name).join(', ')}; or { "screen": "<loading screen name>" }; or "none"
  "camera": { "yaw": 20, "zoom": 1 } }        optional, degrees
Races: ${(await game().catch(() => undefined))?.world.appearance.races.map((r) => r.name).join(', ') ?? 'see the error from check'}.
Sets usually have no weapons: add one by item id when the class holds one. Match armour to the class (plate, mail, leather, cloth) unless asked otherwise, and the class to the race. Prefer distinct, striking looks over near-duplicates. Do not invent ids: use what the searches gave. Check a spec you are unsure of. Make as many looks as asked (default 6, at most 16).
${request.current ? `\nThe look on William's page now:\n${JSON.stringify(request.current)}\n` : ''}
William's request: ${request.prompt}`;
}

function compose(request: ComposeRequest): { id: string } {
  if (!request.prompt?.trim()) throw new Error('Say what to make');
  const job: ComposeJob = { id: randomUUID(), state: 'working', steps: [] };
  jobs.set(job.id, job);
  void (async () => {
    try {
      let result = await runClaude(request.session ? `${request.prompt}${request.current ? `\n\nThe look on the page now: ${JSON.stringify(request.current)}` : ''}` : await brief(request), request.session, job);
      let looks = await checked(result.looks);
      // One round of fixing names that do not place.
      const broken = looks.filter((l) => l.error);
      if (broken.length > 0) {
        job.steps.push(`${broken.length} look${broken.length > 1 ? 's' : ''} did not place; fixing`);
        const fixed = await runClaude(
          `These specs failed to place:\n${broken.map((l) => `- ${l.title}: ${l.error}\n  ${JSON.stringify(l.spec)}`).join('\n')}\nFix them with real ids from the searches, and give back all the looks.`,
          result.session,
          job,
        );
        result = { ...fixed, message: fixed.message || result.message };
        looks = await checked(fixed.looks);
      }
      Object.assign(job, { state: 'done', message: result.message, looks, session: result.session });
    } catch (cause) {
      Object.assign(job, { state: 'failed', error: messageOf(cause) });
    }
  })();
  return { id: job.id };
}

async function checked(looks: Look[]): Promise<Look[]> {
  const { world } = await game();
  return looks.map((look) => {
    try {
      resolveSpec(look.spec, world);
      return { title: look.title, spec: look.spec };
    } catch (cause) {
      return { ...look, error: messageOf(cause) };
    }
  });
}

function runClaude(prompt: string, resume: string | undefined, job: ComposeJob): Promise<{ message: string; looks: Look[]; session?: string }> {
  return new Promise((done, fail) => {
    const args = [
      '-p', prompt,
      '--model', COMPOSER_MODEL,
      '--output-format', 'stream-json', '--verbose',
      '--json-schema', JSON.stringify(LOOKS_SCHEMA),
      // The brief keeps it to this server's API; a narrower rule did not match quoted URLs.
      '--allowedTools', 'Bash(curl:*)',
      '--disallowedTools', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Task',
      ...(resume ? ['--resume', resume] : []),
    ];
    const child = spawn(CLAUDE, args, { cwd: join(root, 'node_modules', '.cache', 'transmogify'), stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    let errors = '';
    let final: { structured_output?: unknown; result?: string; session_id?: string; is_error?: boolean } | undefined;
    const timer = setTimeout(() => child.kill(), 5 * 60_000);
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        let event: { type?: string; message?: { content?: { type: string; name?: string; input?: { command?: string } }[] } } & typeof final;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === 'assistant') {
          for (const part of event.message?.content ?? []) {
            const command = part.type === 'tool_use' ? part.input?.command : undefined;
            if (!command) continue;
            const url = command.match(/api\/([a-z]+)\?([^' ]*)/);
            job.steps.push(url ? `${url[1]}: ${decodeURIComponent(url[2]!.replace(/\+/g, ' ')).replace(/(^|&)brief(&|$)/, '$1').replace(/&/g, ', ')}` : command.includes('/check') ? 'checking a look' : 'looking something up');
          }
        }
        if (event.type === 'result') final = event;
      }
    });
    child.stderr.on('data', (data: Buffer) => (errors += data.toString()));
    child.on('error', fail);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!final || final.is_error) return fail(new Error(`The composer stopped (${code}): ${(final?.result ?? errors).slice(0, 400)}`));
      let output = final.structured_output as { message?: string; looks?: Look[] } | undefined;
      if (!output && final.result) {
        try {
          output = JSON.parse(final.result.slice(final.result.indexOf('{'), final.result.lastIndexOf('}') + 1));
        } catch {
          return fail(new Error(`The composer gave no looks: ${final.result.slice(0, 300)}`));
        }
      }
      done({ message: output?.message ?? '', looks: (output?.looks ?? []).filter((l) => l && typeof l.spec === 'object'), session: final.session_id });
    });
  });
}

// ---- serving ------------------------------------------------------------------------------

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

async function handle(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const send = (status: number, body: string | Buffer, type = 'application/json') => {
    response.writeHead(status, { 'content-type': type, 'cache-control': type === 'image/png' ? 'max-age=86400' : 'no-store' });
    response.end(body);
  };
  try {
    if (url.pathname.startsWith('/api/')) {
      let body: unknown;
      if (request.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      }
      const result = await api(url.pathname.slice(5), url.searchParams, body);
      return typeof result === 'string' ? send(200, result, 'text/plain; charset=utf-8') : send(200, JSON.stringify(result));
    }
    if (url.pathname.startsWith('/icon/')) {
      const png = await icon(Number(url.pathname.slice(6).replace('.png', '')));
      return png ? send(200, png, 'image/png') : send(404, '');
    }
    if (url.pathname.startsWith('/live/')) {
      const file = join(lives(), url.pathname.slice(6).replace(/[^a-z0-9.]/g, ''));
      if (!existsSync(file)) return send(404, '');
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip', 'cache-control': 'max-age=86400' });
      return response.end(await readFile(file));
    }
    if (url.pathname === '/live.js') {
      const file = join(root, 'node_modules', '.cache', 'transmogify', 'dist', 'live.js');
      return existsSync(file) ? send(200, await readFile(file), 'text/javascript') : send(404, '');
    }
    if (url.pathname.startsWith('/renders/')) {
      const file = join(renders(), url.pathname.slice(9).replace(/[^a-z0-9.]/g, ''));
      return existsSync(file) ? send(200, await readFile(file), 'image/png') : send(404, '');
    }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1).replace(/\.\.+/g, '');
    const file = join(root, 'transmogify', name);
    if (!existsSync(file)) return send(404, 'Not found', 'text/plain');
    return send(200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream');
  } catch (cause) {
    if (cause instanceof NotFound) return send(404, JSON.stringify({ error: 'Not found' }));
    return send(400, JSON.stringify({ error: messageOf(cause) }));
  }
}

export async function serve(given: Host): Promise<void> {
  host = given;
  root = given.root;
  await mkdir(join(root, 'node_modules', '.cache', 'transmogify'), { recursive: true });
  // The tailnet address can be missing for a while after the computer starts: keep trying it.
  const listen = (address: string) =>
    new Promise<void>((ready, fail) => {
      const server = createServer((request, response) => void handle(request, response));
      server.once('error', fail);
      server.listen(PORT, address, () => ready());
    }).then(
      () => console.log(`Transmogify on http://${address}:${PORT}`),
      (cause) => {
        console.error(`Could not listen on ${address}:${PORT}: ${messageOf(cause)}; trying again in 30 s`);
        setTimeout(() => void listen(address), 30_000);
      },
    );
  for (const address of HOSTS) await listen(address);
  // Open the game now, so the first visit does not wait for it.
  game().then(
    ({ session }) => console.log(`Read ${PRODUCT} ${session.storage.info.version} from ${WOW}`),
    (cause) => console.error(`Could not open ${WOW}: ${messageOf(cause)}`),
  );
}
