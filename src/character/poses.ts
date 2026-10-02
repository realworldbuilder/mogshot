import type { M2Sequence } from '../formats/m2';
import { animationId } from '../model/animation-names';
import { findSequence } from '../model/pose';
import type { WeaponKind } from './equipment';

/** A named pose: a moment of one of the model's sequences. */
export interface PosePreset {
  name: string;
  /** Index of the sequence in the model. */
  sequence: number;
  /** Time into the sequence, in milliseconds. */
  time: number;
}

type Wielding = WeaponKind | 'unarmed';

const READY: Record<Wielding, string[]> = {
  unarmed: ['ReadyUnarmed'],
  oneHand: ['Ready1H'],
  twoHand: ['Ready2H'],
  long: ['Ready2HL', 'Ready2H'],
  bow: ['ReadyBow'],
  rifle: ['ReadyRifle'],
  crossbow: ['ReadyCrossbow', 'ReadyRifle'],
  thrown: ['ReadyThrown', 'Ready1H'],
};

const ATTACK: Record<Wielding, string[]> = {
  unarmed: ['AttackUnarmed'],
  oneHand: ['Attack1H'],
  twoHand: ['Attack2H'],
  long: ['Attack2HL', 'Attack2H'],
  bow: ['AttackBow'],
  rifle: ['AttackRifle'],
  crossbow: ['AttackCrossbow', 'AttackRifle'],
  thrown: ['AttackThrown', 'Attack1H'],
};

/**
 * The curated poses: a name, the animations to try in order, and how far into the
 * animation the pose is (0 = start, 1 = end). Chosen by looking at each on every race.
 */
function curated(wielding: Wielding): [name: string, animations: string[], at: number][] {
  return [
    ['Stand', ['Stand'], 0],
    ['Ready', READY[wielding], 0],
    ['Attack', ATTACK[wielding], 0.4],
    ['Cast', ['SpellCastDirected', 'ReadySpellDirected'], 0.5],
    ['Roar', ['BattleRoar'], 0.5],
    ['Cheer', ['EmoteCheer'], 0.45],
    ['Point', ['EmotePoint'], 0.5],
    ['Flex', ['EmoteFlex'], 0.5],
    ['Salute', ['EmoteSalute'], 0.5],
    ['Wave', ['EmoteWave'], 0.4],
    ['Kneel', ['KneelLoop', 'EmoteKneel'], 0],
  ];
}

/** The curated poses a model can strike, given what it holds. `available` says whether a sequence's keys can be read. */
export function posePresets(
  sequences: readonly M2Sequence[],
  wielding: Wielding,
  available: (sequence: number) => boolean,
): PosePreset[] {
  const presets: PosePreset[] = [];
  for (const [name, animations, at] of curated(wielding)) {
    for (const animation of animations) {
      const sequence = findSequence(sequences, animationId(animation));
      if (sequence < 0 || !available(sequence)) continue;
      presets.push({ name, sequence, time: Math.round(sequences[sequence]!.duration * at) });
      break;
    }
  }
  return presets;
}
