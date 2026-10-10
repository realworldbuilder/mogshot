import { describe, expect, it } from 'vitest';
import { parseCreatureCache } from '../../src/import/creature-cache';

// The header, three records and the terminator of build 70205's enUS creature cache, byte for byte.
const HEADER = '424f4d57' + '3d120100' + '53556e65' + 'b0020000' + '04000000' + '00000000';
// Stalvan Mistmantle, 315: display 1562, one quest item (3629).
const STALVAN =
  '3b010000840000000000000013000000000000000000005374616c76616e204d6973746d616e746c650000000008000000000000000006000000000000000000000000000100' +
  '00000000803f1a0600000000803f0000803f0000c03f0000803f01000000000000009d060000000000000000000000000000010000003b01000000000000000000002d0e0000';
// Llane Beshere, 911: display 3343, titled "Warrior Trainer".
const LLANE =
  '8f0300008b000000020000000e000000000000000000004c6c616e652042657368657265000000000800000000000000000700000000000000000000000000010000000000c8420f0d' +
  '00000000803f0000c8420000803f0000803f00000000000000009d060000000000000000000000000000010000008f030000000000000000000057617272696f7220547261696e657200';
// Living Flame, 3417: display 1405, a health multiplier of 0.2 after it.
const FLAME =
  '590d00007a000000000000000d000000000000000000004c6976696e6720466c616d65000000000800000000000000000400000000000000000000000000010000' +
  '000000803f7d0500000000803f0000803fcdcc4c3e0000803f00000000000000009f06000000000000000000000000000001000000590d00000000000000000000';
const END = '0000000000000000';

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));

describe('parseCreatureCache', () => {
  it("reads the build, the locale and each record's names and displays", () => {
    const cache = parseCreatureCache(bytes(HEADER + STALVAN + LLANE + FLAME + END));
    expect(cache.build).toBe(70205);
    expect(cache.locale).toBe('enUS');
    expect(cache.entries).toEqual([
      { id: 315, name: 'Stalvan Mistmantle', title: '', displays: [{ id: 1562, scale: 1, probability: 1 }] },
      { id: 911, name: 'Llane Beshere', title: 'Warrior Trainer', displays: [{ id: 3343, scale: 1, probability: 100 }] },
      { id: 3417, name: 'Living Flame', title: '', displays: [{ id: 1405, scale: 1, probability: 1 }] },
    ]);
  });

  it('reads a file with no records', () => {
    expect(parseCreatureCache(bytes(HEADER + END)).entries).toEqual([]);
  });

  it('refuses a file that is not a creature cache', () => {
    expect(() => parseCreatureCache(bytes('424f4d58' + HEADER.slice(8) + END))).toThrow(/not a creature cache/);
    expect(() => parseCreatureCache(new Uint8Array(3))).toThrow(/not a creature cache/);
  });

  it('says so when a record is not consumed exactly', () => {
    // Stalvan's record with its length one byte short: the fields overrun it.
    const short = STALVAN.replace('84000000', '83000000').slice(0, -2);
    expect(() => parseCreatureCache(bytes(HEADER + short + END))).toThrow(/Creature 315's record is 131 bytes, but its fields take 132/);
  });
});
