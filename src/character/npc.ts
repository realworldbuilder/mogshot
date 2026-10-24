import type { Appearance } from './appearance';
import type { CreatureDisplay } from './creatures';
import type { Slot } from './equipment';

/*
 * A humanoid NPC's look as a character request: the player race and sex its display is
 * built on, its appearance choices, the item looks it wears and the painted body (bake) the
 * game draws it with. Shared by the command line's `npc` spec and the worker's fighter.
 */

export interface HumanoidLook {
  raceId: number;
  sex: number;
  choices: Map<number, number>;
  wear: Map<Slot, number>;
  /** The bake file to draw, if one is on disk. */
  bake: number | undefined;
  /** The game's size for the display. */
  scale: number;
  /** What is drawn differently from the game, in words. */
  problems: string[];
}

/** Whether a display is drawn on a player model, so it can be built as a character. */
export const isHumanoid = (display: CreatureDisplay): boolean => display.humanoid !== undefined;

/**
 * Resolve a humanoid display to what buildCharacterScene needs. `installed` says whether
 * a file is on disk, as a bake may be missing from a partial install. Throws for a display
 * with a model of its own (a dragon, a unique boss model), which no player model can draw.
 */
export function humanoidLook(
  display: CreatureDisplay,
  appearance: Appearance,
  installed: (fileId: number) => boolean,
  name = `Creature display ${display.id}`,
): HumanoidLook {
  const { humanoid } = display;
  if (!humanoid) throw new Error(`${name} has a model of its own (file ${display.modelFileId}), not a player's, so it cannot be built as a character`);
  const problems: string[] = [];
  const { raceId, sex } = humanoid;
  const model = appearance.model(raceId, sex);
  if (!model) throw new Error(`${name} is drawn as race ${raceId}, ${sex === 1 ? 'female' : 'male'}, which this build has no player model for`);
  if (display.modelFileId !== model.fileId) {
    problems.push(`The game draws ${name} with model file ${display.modelFileId}, not the player model (file ${model.fileId}) drawn here`);
  }
  // The bake made for the model's texture size, if it is on disk; else the other one.
  const hd = (appearance.skinSize(model)?.width ?? 0) >= 2048;
  const [wanted, other] = hd ? [humanoid.hdBakeFileId, humanoid.bakeFileId] : [humanoid.bakeFileId, humanoid.hdBakeFileId];
  let bake: number | undefined;
  if (wanted && installed(wanted)) bake = wanted;
  else if (other && installed(other)) {
    bake = other;
    problems.push(`The ${hd ? 'high-res' : 'standard'} painted body of ${name} (file ${wanted || 'none listed'}) is not on disk, so the ${hd ? 'standard' : 'high-res'} one is drawn`);
  } else if (wanted || other) problems.push(`No painted body of ${name} is on disk (files ${[wanted, other].filter(Boolean).join(', ')}); the skin is drawn from the choices instead`);
  return { raceId, sex, choices: new Map(humanoid.choices), wear: new Map(humanoid.wear), bake, scale: display.scale, problems };
}
