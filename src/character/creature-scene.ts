import type { CascStorage } from '../casc/storage';
import type { CharacterRig, CharacterScene, PoseRequest } from './scene';
import { sceneReaders } from './scene';

/*
 * A creature drawn from its own model: a beast, an elemental, a pet. Nothing is composited;
 * the display's texture variations fill the model's creature skin slots.
 */

/** What a creature display gives the scene: its model, its skin textures and its size. */
export interface CreatureLook {
  modelFileId: number;
  /** Texture files for the model's creature skin slots, in order; 0 where there is none. */
  textures: number[];
  scale: number;
}

/** The M2 texture types a creature display's three texture variations fill. */
const CREATURE_SKIN_TYPES = [11, 12, 13];

/**
 * Build a creature in a pose. Every section of the model is shown: creature models keep
 * their variants (a saddle, a second set of horns) as sections too, and which the game
 * shows is not read yet, so a model with variants shows them all.
 */
export async function buildCreatureScene(
  storage: CascStorage,
  look: CreatureLook,
  options: { pose?: PoseRequest } = {},
): Promise<{ scene: CharacterScene; rig: CharacterRig }> {
  const readers = sceneReaders(storage);
  const { problems } = readers;
  const body = await readers.readModel(look.modelFileId, 'The creature model');
  if (!body) throw new Error(problems[problems.length - 1]);
  const { model, skin } = body;
  if (model.skeletonFileId !== 0) {
    throw new Error('This model keeps its skeleton in a separate file, which Mogshot cannot read yet');
  }
  const builder = readers.body(model, look.scale);

  const overrides = new Map<number, number>();
  look.textures.forEach((fileId, i) => {
    if (fileId && CREATURE_SKIN_TYPES[i] !== undefined) overrides.set(CREATURE_SKIN_TYPES[i]!, fileId);
  });
  const meshes = [await builder.buildMesh(model, skin, skin.sections.map(() => true), 'body', undefined, overrides)];

  const presets = builder.presets('unarmed');
  const animations = builder.animations();
  const chosen = builder.choose(options.pose, presets);
  const first = await builder.pose(chosen.sequence, chosen.time, chosen.preset);
  builder.apply(first);

  const scene: CharacterScene = {
    meshes,
    textures: builder.textures,
    bounds: first.bounds,
    problems,
    options: [],
    choices: [],
    animations,
    presets,
    pose: first.pose,
  };
  return { scene, rig: { pose: (sequence, time) => builder.pose(sequence, time) } };
}
