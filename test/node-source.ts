import { existsSync } from 'node:fs';
import { join } from 'node:path';

export { NodeSource } from '../src/io/node-source';

/** The game install used by client-backed tests. Tests are skipped when it is absent. */
export const WOW_DIR = process.env.WOW_DIR ?? '/Applications/World of Warcraft';
export const hasClient = existsSync(join(WOW_DIR, '.build.info'));
