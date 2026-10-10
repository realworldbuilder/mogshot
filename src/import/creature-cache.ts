/*
 * The client's creature cache: Cache/WDB/<locale>/creaturecache.wdb, where the game writes
 * the name, title and display ids of every NPC the server has described to this computer.
 * It is the only place a classic client keeps NPC names, so an NPC can be named here only
 * once the player has been near it.
 *
 * The layout follows wowdev.wiki (WDB) and TrinityCore's QueryCreatureResponse::Write, and was
 * checked byte for byte on three records of build 1.60.1.70205. A pure function: no files.
 */

export interface CachedDisplay {
  id: number;
  scale: number;
  probability: number;
}

export interface CachedCreature {
  /** The creature (NPC) id. */
  id: number;
  name: string;
  title: string;
  /** The looks the server gave the creature; the game picks one by probability. */
  displays: CachedDisplay[];
}

export interface CreatureCache {
  /** The client build that wrote the file. */
  build: number;
  locale: string;
  entries: CachedCreature[];
}

const HEADER_SIZE = 24;
const MAGIC = 'BOMW';
/** The bit-packed string lengths at the start of a record: 11 bits for a name, 6 for a cursor name, 1 for the leader flag. */
const BIT_FIELDS: [name: string, bits: number][] = [
  ['title', 11], ['titleAlt', 11], ['cursorName', 6], ['leader', 1],
  ['name0', 11], ['nameAlt0', 11], ['name1', 11], ['nameAlt1', 11],
  ['name2', 11], ['nameAlt2', 11], ['name3', 11], ['nameAlt3', 11],
];
const BIT_FIELD_BYTES = 15;
const FLAG_BYTES = 12;
/** Movement info, health scaling expansion, required expansion, vignette, class, difficulty, two widget set ids. */
const TRAILING_INTS = 8;

const utf8 = new TextDecoder();

export function parseCreatureCache(bytes: Uint8Array): CreatureCache {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) => utf8.decode(bytes.subarray(at, at + length));
  if (bytes.length < HEADER_SIZE || text(0, 4) !== MAGIC) throw new Error('This is not a creature cache file (no BOMW header)');
  const build = view.getUint32(4, true);
  // The locale is stored as a reversed four-character code: "SUne" for enUS.
  const locale = text(8, 4).split('').reverse().join('');

  const entries: CachedCreature[] = [];
  let at = HEADER_SIZE;
  while (at + 8 <= bytes.length) {
    const id = view.getUint32(at, true);
    const length = view.getUint32(at + 4, true);
    at += 8;
    if (id === 0 && length === 0) break;
    const end = at + length;
    if (end > bytes.length) throw new Error(`Creature ${id}'s record runs past the end of the file`);
    entries.push(readRecord(id, bytes, view, at, end));
    at = end;
  }
  return { build, locale, entries };
}

/** One record: `at` is the start of its body, `end` the byte after it. Throws if the body is not consumed exactly. */
function readRecord(id: number, bytes: Uint8Array, view: DataView, at: number, end: number): CachedCreature {
  if (end - at < BIT_FIELD_BYTES) throw new Error(`Creature ${id}'s record is too short`);
  const lengths = readBitFields(bytes, at);
  let pos = at + BIT_FIELD_BYTES;
  const string = (length: number): string => {
    if (length === 0) return '';
    const value = utf8.decode(bytes.subarray(pos, pos + length - 1));
    pos += length;
    return value;
  };

  const names: string[] = [];
  for (let i = 0; i < 4; i++) {
    names.push(string(lengths.get(`name${i}`)!));
    string(lengths.get(`nameAlt${i}`)!);
  }
  pos += FLAG_BYTES;
  pos += 1; // creature type
  pos += 4; // family
  pos += 1; // classification
  pos += 8; // two proxy creature ids
  const displayCount = view.getUint32(pos, true);
  pos += 8; // the count and the total probability
  const displays: CachedDisplay[] = [];
  for (let i = 0; i < displayCount; i++) {
    displays.push({ id: view.getUint32(pos, true), scale: view.getFloat32(pos + 4, true), probability: view.getFloat32(pos + 8, true) });
    pos += 12;
  }
  pos += 8; // health and energy multipliers
  const questItems = view.getUint32(pos, true);
  const questCurrencies = view.getUint32(pos + 4, true);
  pos += 8 + TRAILING_INTS * 4;
  const title = string(lengths.get('title')!);
  string(lengths.get('titleAlt')!);
  string(lengths.get('cursorName')!);
  pos += questItems * 4 + questCurrencies * 4;
  if (pos !== end) throw new Error(`Creature ${id}'s record is ${end - at} bytes, but its fields take ${pos - at}: the layout has changed`);
  return { id, name: names[0]!, title, displays };
}

/** The packed string lengths, most significant bit first, each including its terminator. */
function readBitFields(bytes: Uint8Array, at: number): Map<string, number> {
  const fields = new Map<string, number>();
  let bit = 0;
  for (const [name, width] of BIT_FIELDS) {
    let value = 0;
    for (let i = 0; i < width; i++, bit++) {
      value = (value << 1) | ((bytes[at + (bit >> 3)]! >> (7 - (bit & 7))) & 1);
    }
    fields.set(name, value);
  }
  return fields;
}
