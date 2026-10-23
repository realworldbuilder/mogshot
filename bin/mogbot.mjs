#!/usr/bin/env node
// Mogbot: Mogshot in Discord. One slash command, /mog, draws a character from the game files
// and posts the picture (or a looping clip) in the chat. Every picture goes through the command
// line (bin/mogshot.mjs), one at a time; this file only turns the command's options into a spec,
// keeps the queue, and talks to Discord.
//
//   mogbot                  run the bot (needs DISCORD_TOKEN in ~/.config/wfg/mogbot.env)
//   mogbot register         push the /mog command definition to Discord (DISCORD_TOKEN, DISCORD_APP_ID)
//   mogbot catalog          rebuild the list of races and sets the autocomplete offers
//   mogbot try '<options>'  draw one picture the way /mog would, without Discord, to mogbot-try.png
//                           options as key=value words: race="Night Elf" sex=female set="Judgment Armor"
//                           product=retail pose=Roar backdrop=Ember clip=true code="MOG2;…", or a JSON object;
//                           --out <file> says where it goes
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ENV_FILE = join(homedir(), '.config', 'wfg', 'mogbot.env');
const CATALOG_FILE = join(root, 'node_modules', '.cache', 'mogbot', 'catalog.json');
const MACBOOK_WOW = 'williams-macbook-pro-2:/Applications/World of Warcraft';

/** The page's eleven curated poses, in its order. */
const POSES = ['Stand', 'Ready', 'Attack', 'Cast', 'Roar', 'Cheer', 'Point', 'Flex', 'Salute', 'Wave', 'Kneel'];
/** The page's gradients (src/render/backdrop.ts), darkest first. */
const GRADIENTS = ['Slate', 'Ember', 'Frost', 'Fel', 'Gold', 'Arcane', 'Forest', 'Blood'];
const DEFAULT_BACKDROP = 'Slate';
const PRODUCT_NAMES = ['classic', 'retail'];
const MAX_CLIP_SECONDS = 10;
const RENDERS_PER_HOUR = 20;
const RENDER_TIMEOUT_MS = 180_000;
/** Discord takes files up to 10 MB from an app without a boosted server. */
const MAX_UPLOAD = 10 * 1024 * 1024;

// ---------------------------------------------------------------- configuration

/** KEY=VALUE lines from the env file; the process environment wins over the file. */
function loadEnv() {
  const env = {};
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !line.trim().startsWith('#')) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  for (const key of ['DISCORD_TOKEN', 'DISCORD_APP_ID', 'WOW_DIR', 'WOW_DIR_RETAIL', 'WOW_PRODUCT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

const env = loadEnv();
const config = {
  token: env.DISCORD_TOKEN ?? '',
  appId: env.DISCORD_APP_ID ?? '',
  /** The game folder and product behind each name the `product` option offers. */
  products: {
    classic: { wow: env.WOW_DIR || '/Applications/World of Warcraft', product: env.WOW_PRODUCT || 'wow_classic_beta' },
    retail: { wow: env.WOW_DIR_RETAIL || MACBOOK_WOW, product: 'wow' },
  },
};

const log = (...words) => console.log(new Date().toISOString(), ...words);
const messageOf = (cause) => (cause instanceof Error ? cause.message : String(cause));
const plain = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------- the catalog

/**
 * What the autocomplete offers: each product's races, classes, class sets and transmog set
 * names, read once from the game files (through the CLI's own tables) and kept in a JSON file,
 * so the bot itself never holds a game install in memory.
 */
let catalog = existsSync(CATALOG_FILE) ? JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) : undefined;

async function buildCatalog() {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    appType: 'mpa',
    cacheDir: 'node_modules/.vite-mogbot',
    server: { host: '127.0.0.1', port: 4178, hmr: false, watch: null },
  });
  const built = { built: new Date().toISOString(), products: {} };
  try {
    const { Session } = await server.ssrLoadModule('/cli/session.ts');
    const cacheDir = join(root, 'node_modules', '.cache', 'mogshot', 'cli');
    for (const [name, { wow, product }] of Object.entries(config.products)) {
      const entry = { wow, product, races: [], classes: [], classSets: [], transmog: [] };
      built.products[name] = entry;
      try {
        const session = await Session.open(wow, cacheDir, product);
        const [appearance, equipment, classes] = await Promise.all([session.appearance(), session.equipment(), session.classes()]);
        entry.races = [...new Set(appearance.races.map((r) => r.name))];
        entry.classes = classes.map((c) => c.name);
        for (const c of classes) {
          for (const set of equipment.sets(c.id)) entry.classSets.push({ name: set.name, class: c.name, level: set.level });
        }
        try {
          const sets = (await session.transmogSets()).sets;
          // One entry a name: the base set (no parent) before its variants.
          const byName = new Map();
          for (const set of [...sets].sort((a, b) => Number(a.parentId > 0) - Number(b.parentId > 0) || a.id - b.id)) {
            if (!byName.has(set.name)) {
              byName.set(set.name, { name: set.name, kind: set.kind, expansion: set.expansion, classes: set.classes.map((id) => classes.find((c) => c.id === id)?.name ?? `Class ${id}`) });
            }
          }
          entry.transmog = [...byName.values()];
        } catch (cause) {
          entry.transmogError = messageOf(cause);
        }
      } catch (cause) {
        entry.error = messageOf(cause);
      }
      log(`catalog ${name}: ${entry.error ?? `${entry.races.length} races, ${entry.classSets.length} class sets, ${entry.transmog.length} transmog sets`}`);
    }
  } finally {
    await server.close();
  }
  await mkdir(join(CATALOG_FILE, '..'), { recursive: true });
  await writeFile(CATALOG_FILE, JSON.stringify(built));
  catalog = built;
  return built;
}

/** Build the catalog in a child, so the sessions' memory goes away with it. */
async function ensureCatalog() {
  if (catalog) return catalog;
  log('building the catalog');
  const { code, stderr } = await exec(process.execPath, [fileURLToPath(import.meta.url), 'catalog'], { cwd: root, timeout: 300_000 });
  if (code !== 0) log(`the catalog could not be built: ${stderr.trim()}`);
  if (existsSync(CATALOG_FILE)) catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
  return catalog;
}

const productCatalog = (product) => catalog?.products?.[product];

// ---------------------------------------------------------------- options to spec

const CLASS_SET = 'C:';
const TRANSMOG_SET = 'T:';

/** An autocomplete choice carries which table its set came from; typed words are searched. */
function setOf(text, product) {
  const value = text.trim();
  if (value.startsWith(CLASS_SET)) {
    const [, className, ...rest] = value.split(':');
    return { spec: { class: className, name: rest.join(':') }, label: `${rest.join(':')} (${className} set)` };
  }
  if (value.startsWith(TRANSMOG_SET)) return { spec: { name: value.slice(TRANSMOG_SET.length) }, label: value.slice(TRANSMOG_SET.length) };
  const table = productCatalog(product);
  const wanted = plain(value);
  if (wanted === '') throw new Error('The set is empty; type part of its name and pick one from the list.');
  const className = (table?.classes ?? []).find((c) => plain(c) === wanted);
  if (className) {
    const best = (table?.classSets ?? []).find((s) => s.class === className);
    return { spec: { class: className }, label: best ? `${best.name} (${className} set)` : `the best ${className} set` };
  }
  const classSets = table?.classSets ?? [];
  const transmog = table?.transmog ?? [];
  // A name in both tables (Judgment Armor is a classic item set and a retail transmog set) is the
  // transmog set on retail, where each piece is drawn in the set's own look, and the class set on classic.
  const asClassSet = (s) => ({ spec: { class: s.class, name: s.name }, label: `${s.name} (${s.class} set)` });
  const asTransmog = (s) => ({ spec: { name: s.name }, label: s.name });
  const tables = product === 'retail' ? [[transmog, asTransmog], [classSets, asClassSet]] : [[classSets, asClassSet], [transmog, asTransmog]];
  for (const [list, as] of tables) {
    const exact = list.find((s) => plain(s.name) === wanted);
    if (exact) return as(exact);
  }
  const partial = tables.flatMap(([list, as]) => list.filter((s) => plain(s.name).includes(wanted)).map(as));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(`"${value}" could be more than one set: ${partial.slice(0, 12).map((p) => p.label).join(', ')}${partial.length > 12 ? ', …' : ''}. Pick one from the list.`);
  }
  if (table && !table.error) {
    throw new Error(`There is no set called "${value}" in ${product}. Type part of a name and pick one from the list${product === 'classic' ? ', or try product: retail for the transmog sets' : ''}.`);
  }
  // No catalog to check against: let the renderer say.
  return { spec: { name: value }, label: value };
}

/**
 * The /mog options as a spec for the command line, with what the summary line will say.
 * Throws, in words, when the options cannot make a picture.
 */
export function buildSpec(options) {
  const product = (options.product ?? 'classic').toLowerCase();
  if (!PRODUCT_NAMES.includes(product)) throw new Error(`The product is classic or retail, not "${options.product}".`);
  const spec = {};
  if (options.code) {
    const code = String(options.code).trim();
    if (!/^MOG\d+;/.test(code)) throw new Error('That is not a MOG code. In the game, with the Mogshot addon on, type /mogshot and paste the code it shows.');
    spec.character = code;
  }
  if (options.race) spec.race = String(options.race).trim();
  if (options.sex) {
    const sex = String(options.sex).toLowerCase();
    if (sex !== 'male' && sex !== 'female') throw new Error('Sex is male or female.');
    spec.sex = sex;
  }
  if (!spec.character && !spec.race) throw new Error('Pick a race, or paste a MOG code from the game.');
  let setLabel;
  if (options.set) {
    const set = setOf(String(options.set), product);
    spec.set = set.spec;
    setLabel = set.label;
  }
  const poseWord = String(options.pose ?? 'Stand');
  const pose = POSES.find((p) => plain(p) === plain(poseWord));
  if (!pose) throw new Error(`There is no pose called "${poseWord}". The poses are: ${POSES.join(', ')}.`);
  spec.pose = pose;
  const backdropWord = String(options.backdrop ?? DEFAULT_BACKDROP);
  const transparent = plain(backdropWord) === 'transparent' || plain(backdropWord) === 'none';
  const backdrop = transparent ? undefined : GRADIENTS.find((g) => plain(g) === plain(backdropWord));
  if (!transparent && !backdrop) throw new Error(`There is no backdrop called "${backdropWord}". The backdrops are: ${GRADIENTS.join(', ')}, transparent.`);
  if (backdrop) spec.backdrop = backdrop;
  const clip = options.clip === true || String(options.clip).toLowerCase() === 'true';
  const notes = [];
  if (clip) {
    spec.clip = true;
    spec.size = 'square';
    if (transparent) notes.push('A clip cannot be transparent, so its background is black.');
  } else {
    // A transparent character is cropped to itself; one on a backdrop fills a portrait frame.
    spec.size = transparent ? { width: 1440, height: 1920, tight: true } : { width: 1080, height: 1350, tight: false };
  }
  return { spec, product, clip, file: clip ? 'mog.mp4' : 'mog.png', setLabel, notes };
}

// ---------------------------------------------------------------- rendering

function exec(command, args, { cwd, timeout, input } = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeout && setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (cause) => { clearTimeout(timer); done({ code: -1, stdout, stderr: `${stderr}${messageOf(cause)}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr, timedOut }); });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/** One render at a time, in the order asked. */
class Queue {
  constructor() {
    this.tail = Promise.resolve();
    this.length = 0;
  }
  run(task) {
    this.length++;
    const result = this.tail.then(task).finally(() => { this.length--; });
    this.tail = result.catch(() => {});
    return result;
  }
}
export const queue = new Queue();

/**
 * Draw a job's spec through the command line into `dir`. The spec goes in a file there:
 * `render -` would read it from standard input, but under this Node it exits without reading.
 */
export async function render(job, dir, spec = job.spec) {
  const out = join(dir, job.file);
  const specFile = join(dir, 'spec.json');
  await writeFile(specFile, JSON.stringify({ ...spec, out }));
  const { wow, product } = config.products[job.product];
  const args = [join(root, 'bin', 'mogshot.mjs'), '--wow', wow, '--product', product, 'render', specFile];
  const { code, stdout, stderr, timedOut } = await exec(process.execPath, args, { cwd: root, timeout: RENDER_TIMEOUT_MS });
  if (timedOut) throw new Error(`The render took more than ${RENDER_TIMEOUT_MS / 1000} seconds and was stopped.`);
  let pictures;
  try {
    pictures = JSON.parse(stdout);
  } catch {
    const said = stderr.trim().split('\n').filter(Boolean).pop() ?? '';
    throw new Error(said || `The renderer stopped (code ${code}) without saying why.`);
  }
  const report = pictures[0] ?? {};
  if (report.error) throw new Error(report.error);
  if (!existsSync(out)) throw new Error('The renderer finished but wrote no file.');
  return { file: out, report };
}

/** A job's picture, with a clip cut to the cap when one pass of its animation runs longer. */
export async function renderJob(job, dir) {
  let result = await render(job, dir);
  const length = result.report.clip?.length;
  if (job.clip && length > MAX_CLIP_SECONDS) {
    result = await render(job, dir, { ...job.spec, clip: { seconds: MAX_CLIP_SECONDS } });
    result.report.notes = [...(result.report.notes ?? []), `One pass of ${result.report.clip?.animation ?? 'the animation'} is ${length} s, so the clip is the first ${MAX_CLIP_SECONDS} s.`];
  }
  return result;
}

/** The line under the picture: race, sex, set, pose, and anything that could not be drawn. */
export function summarize(job, report) {
  const parts = [
    [report.race, report.sex].filter(Boolean).join(' '),
    job.setLabel,
    report.pose,
    job.clip && report.clip ? `${report.clip.length} s loop` : undefined,
    job.product,
  ].filter(Boolean);
  const lines = [parts.join(' · ')];
  const problems = report.problems ?? [];
  if (problems.length > 0) lines.push(`Could not draw: ${problems.join('; ')}`);
  for (const note of [...job.notes, ...(report.notes ?? []).filter((n) => !n.startsWith('Transmog set '))]) lines.push(note);
  const text = lines.join('\n');
  return text.length > 1900 ? `${text.slice(0, 1897)}…` : text;
}

// ---------------------------------------------------------------- rate limits

const inFlight = new Set();
const history = new Map();

/** Why a user cannot render now, or undefined when they can (and the render is counted). */
export function admit(userId, now = Date.now()) {
  if (inFlight.has(userId)) return 'One at a time: your last /mog is still rendering.';
  const times = (history.get(userId) ?? []).filter((t) => now - t < 3_600_000);
  if (times.length >= RENDERS_PER_HOUR) {
    const minutes = Math.max(1, Math.ceil((times[0] + 3_600_000 - now) / 60_000));
    history.set(userId, times);
    return `That is ${RENDERS_PER_HOUR} renders in an hour, the most one person gets. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  times.push(now);
  history.set(userId, times);
  inFlight.add(userId);
  return undefined;
}

export const release = (userId) => inFlight.delete(userId);

// ---------------------------------------------------------------- autocomplete

/**
 * Up to 25 choices whose key (the set's or race's own name, not what is shown after it) has
 * the words typed, the ones that start with them first. Discord allows 100 characters each.
 */
function pick(candidates, text) {
  const wanted = plain(text);
  return candidates
    .map((c) => ({ ...c, at: wanted === '' ? 0 : plain(c.key).indexOf(wanted) }))
    .filter((c) => c.at >= 0)
    .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
    .slice(0, 25)
    .map(({ name, value }) => ({ name: name.slice(0, 100), value: value.slice(0, 100) }));
}

export function raceChoices(text, product) {
  const table = productCatalog(product);
  return pick((table?.races ?? []).map((name) => ({ key: name, name, value: name })), text);
}

export function setChoices(text, product) {
  const table = productCatalog(product);
  if (!table) return [];
  const classSets = table.classSets.map((s) => ({ key: s.name, name: `${s.name} (${s.class} set)`, value: `${CLASS_SET}${s.class}:${s.name}` }));
  const transmog = table.transmog.map((s) => ({
    key: s.name,
    name: [s.name, s.expansion, s.classes.length === 1 ? s.classes[0] : undefined].filter(Boolean).join(' · '),
    value: `${TRANSMOG_SET}${s.name}`,
  }));
  // The table that product dresses from best comes first among equal matches (see setOf).
  return pick(product === 'retail' ? [...transmog, ...classSets] : [...classSets, ...transmog], text);
}

// ---------------------------------------------------------------- Discord

async function discord() {
  return import('discord.js');
}

async function commandDefinition() {
  const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType } = await discord();
  return new SlashCommandBuilder()
    .setName('mog')
    .setDescription('Draw a World of Warcraft character in a transmog set, from the game files')
    .addStringOption((o) => o.setName('race').setDescription('The race (Night Elf, Orc, …); leave out when you paste a code').setAutocomplete(true))
    .addStringOption((o) => o.setName('sex').setDescription('Male or female').addChoices({ name: 'male', value: 'male' }, { name: 'female', value: 'female' }))
    .addStringOption((o) => o.setName('set').setDescription('A transmog set (retail) or a class set (classic), by name').setAutocomplete(true))
    .addStringOption((o) => o.setName('pose').setDescription('How the character stands (Stand unless said)').addChoices(...POSES.map((p) => ({ name: p, value: p }))))
    .addStringOption((o) =>
      o.setName('backdrop').setDescription('What is behind the character (Slate, a dark gradient, unless said)').addChoices(...GRADIENTS.map((g) => ({ name: g, value: g })), { name: 'transparent', value: 'transparent' }),
    )
    .addBooleanOption((o) => o.setName('clip').setDescription('A looping video of the pose instead of a picture'))
    .addStringOption((o) => o.setName('product').setDescription('Which game to read: classic (default) or retail').addChoices({ name: 'classic', value: 'classic' }, { name: 'retail', value: 'retail' }))
    .addStringOption((o) => o.setName('code').setDescription('A MOG code from /mogshot in the game: your own character, as worn'))
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel);
}

function needToken(what) {
  if (!config.token) throw new Error(`DISCORD_TOKEN is empty: ${what} needs the bot token in ${ENV_FILE}.`);
}

const installLinks = (appId) => [
  `Add to a server: https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=0`,
  `Add to your account (works in any server): https://discord.com/oauth2/authorize?client_id=${appId}&integration_type=1&scope=applications.commands`,
];

async function registerCommand() {
  needToken('register');
  if (!config.appId) throw new Error(`DISCORD_APP_ID is empty: register needs the application id in ${ENV_FILE}.`);
  const { REST, Routes } = await discord();
  const rest = new REST().setToken(config.token);
  const command = await commandDefinition();
  const result = await rest.put(Routes.applicationCommands(config.appId), { body: [command.toJSON()] });
  log(`registered ${result.length} command(s): ${result.map((c) => `/${c.name}`).join(', ')}`);
  for (const line of installLinks(config.appId)) console.log(line);
}

/** The options of an interaction as the spec builder takes them. */
function optionsOf(interaction) {
  return {
    code: interaction.options.getString('code') ?? undefined,
    race: interaction.options.getString('race') ?? undefined,
    sex: interaction.options.getString('sex') ?? undefined,
    set: interaction.options.getString('set') ?? undefined,
    pose: interaction.options.getString('pose') ?? undefined,
    backdrop: interaction.options.getString('backdrop') ?? undefined,
    clip: interaction.options.getBoolean('clip') ?? false,
    product: interaction.options.getString('product') ?? undefined,
  };
}

async function handleMog(interaction, AttachmentBuilder) {
  // Discord gives three seconds to answer; a render takes longer, so answer now and edit later.
  await interaction.deferReply();
  const userId = interaction.user.id;
  const refusal = admit(userId);
  if (refusal) {
    await interaction.editReply(refusal);
    return;
  }
  const started = Date.now();
  let dir;
  try {
    const job = buildSpec(optionsOf(interaction));
    dir = await mkdtemp(join(tmpdir(), 'mogbot-'));
    const ahead = queue.length;
    if (ahead > 0) await interaction.editReply(`In line behind ${ahead} render${ahead === 1 ? '' : 's'}…`);
    const { file, report } = await queue.run(() => renderJob(job, dir));
    const size = (await stat(file)).size;
    if (size > MAX_UPLOAD) throw new Error(`The ${job.clip ? 'clip' : 'picture'} came out at ${(size / 1048576).toFixed(1)} MB, more than Discord takes (10 MB).`);
    const name = `${[report.race, report.sex, job.setLabel?.split(' (')[0], report.pose].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-')}.${job.clip ? 'mp4' : 'png'}`;
    await interaction.editReply({ content: summarize(job, report), files: [new AttachmentBuilder(file, { name })] });
    log(`${interaction.user.tag ?? userId}: ${summarize(job, report).split('\n')[0]} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  } catch (cause) {
    const said = messageOf(cause);
    log(`${interaction.user.tag ?? userId}: failed: ${said}`);
    await interaction.editReply(said.length > 1900 ? `${said.slice(0, 1897)}…` : said).catch(() => {});
  } finally {
    release(userId);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runBot() {
  needToken('the bot');
  const { Client, Events, AttachmentBuilder } = await discord();
  await ensureCatalog();
  if (!catalog) log('no catalog: autocomplete will offer nothing until `mogbot catalog` works');
  const client = new Client({ intents: [] });
  client.once(Events.ClientReady, (ready) => {
    log(`ready as ${ready.user.tag}`);
    for (const line of installLinks(ready.application?.id ?? config.appId)) log(line);
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete() && interaction.commandName === 'mog') {
        const focused = interaction.options.getFocused(true);
        const product = (interaction.options.getString('product') ?? 'classic').toLowerCase();
        const choices = focused.name === 'race' ? raceChoices(focused.value, product) : focused.name === 'set' ? setChoices(focused.value, product) : [];
        await interaction.respond(choices);
      } else if (interaction.isChatInputCommand() && interaction.commandName === 'mog') {
        await handleMog(interaction, AttachmentBuilder);
      }
    } catch (cause) {
      log(`interaction failed: ${messageOf(cause)}`);
    }
  });
  client.on(Events.Error, (cause) => log(`client error: ${messageOf(cause)}`));
  await client.login(config.token);
  // Logged in; the client keeps running until the process is stopped.
  await new Promise(() => {});
}

// ---------------------------------------------------------------- try

/** `key=value` words, quoted where the value has spaces, or a JSON object. */
export function parseOptions(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const options = {};
  const pattern = /([a-z]+)=(?:"([^"]*)"|'([^']*)'|(\S+))/gi;
  let match;
  while ((match = pattern.exec(trimmed))) options[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
  if (Object.keys(options).length === 0) throw new Error('Give options as key=value words, e.g. race="Night Elf" sex=female set="Judgment Armor" product=retail');
  return options;
}

async function tryCommand(args) {
  const outFlag = args.indexOf('--out');
  let out;
  if (outFlag >= 0) [, out] = args.splice(outFlag, 2);
  const options = parseOptions(args.join(' '));
  await ensureCatalog();
  const job = buildSpec(options);
  out = resolve(out ?? `mogbot-try.${job.clip ? 'mp4' : 'png'}`);
  const dir = await mkdtemp(join(tmpdir(), 'mogbot-'));
  try {
    const { file, report } = await queue.run(() => renderJob(job, dir));
    await mkdir(join(out, '..'), { recursive: true });
    await writeFile(out, await readFile(file));
    console.log(summarize(job, report));
    console.log(`-> ${out} (${((await stat(out)).size / 1024).toFixed(0)} KB, ${report.seconds} s)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- main

const HELP = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');

if (basename(process.argv[1] ?? '') === basename(fileURLToPath(import.meta.url))) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    switch (command) {
      case undefined:
      case 'run':
        await runBot();
        break;
      case 'register':
        await registerCommand();
        break;
      case 'catalog':
        await buildCatalog();
        break;
      case 'try':
        await tryCommand(rest);
        break;
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP);
        break;
      default:
        throw new Error(`There is no command "${command}". Run mogbot help.`);
    }
  } catch (cause) {
    console.error(messageOf(cause));
    process.exit(1);
  }
  // A session read over ssh keeps its connection open; nothing is left to wait for.
  process.exit(0);
}
