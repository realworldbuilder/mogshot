import { describe, expect, it } from 'vitest';
import { pickedFiles } from '../../src/io/file-list-source';

const fileAt = (path: string): File => {
  const file = new File([''], path.split('/').pop()!);
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
};

describe('picked files', () => {
  it('keeps the game data and the Mogshot addon file, nothing else', () => {
    const picked = pickedFiles([
      fileAt('World of Warcraft/.build.info'),
      fileAt('World of Warcraft/Data/data/data.000'),
      fileAt('World of Warcraft/Data/config/ab/cd/abcd'),
      fileAt('World of Warcraft/_classic_beta_/WTF/Account/123#1/SavedVariables/Mogshot.lua'),
      fileAt('World of Warcraft/_classic_beta_/WTF/Account/123#1/SavedVariables/Other.lua'),
      fileAt('World of Warcraft/_classic_beta_/WTF/Account/SavedVariables/Mogshot.lua'),
      fileAt('World of Warcraft/_classic_beta_/Interface/AddOns/Mogshot/Mogshot.lua'),
      fileAt('World of Warcraft/_retail_/WTF/Account/123#1/70/Thrall/SavedVariables/Mogshot.lua'),
      fileAt('World of Warcraft/Launcher.db'),
    ]);
    expect(picked.map((p) => p.path)).toEqual([
      '.build.info',
      'Data/data/data.000',
      'Data/config/ab/cd/abcd',
      '_classic_beta_/WTF/Account/123#1/SavedVariables/Mogshot.lua',
    ]);
  });
});
