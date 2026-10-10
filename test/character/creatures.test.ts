import { describe, expect, it } from 'vitest';
import { NPC_SLOTS } from '../../src/character/creatures';

describe('NPC_SLOTS', () => {
  it('maps the NPC item slot numbers to the character slots', () => {
    expect(NPC_SLOTS).toHaveLength(11);
    // Verified by Tyrande Whisperwind's rows.
    expect(NPC_SLOTS[0]).toBe('head');
    expect(NPC_SLOTS[2]).toBe('shirt');
    expect(NPC_SLOTS[5]).toBe('legs');
    expect(NPC_SLOTS[8]).toBe('hands');
    expect(NPC_SLOTS[10]).toBe('back');
    expect(new Set(NPC_SLOTS).size).toBe(11);
  });
});
