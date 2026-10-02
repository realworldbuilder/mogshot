# Mogshot

A web page that turns a World of Warcraft character into a transparent PNG, using the game files already on your computer. Free, no account, no server. Your game files are read in your browser and never leave your machine.

Site: https://realworldbuilder.github.io/mogshot/

## Status

Not usable for making images yet. This section is updated as things actually work; it lists nothing that doesn't.

What works today, in Chrome on a Mac, against WoW build 1.60.1.70170 (`wow_classic_beta`):

- Drag your World of Warcraft folder onto the page, or choose it with the button.
- The page draws one character from your game files: a human male with the first choice of every appearance option, in the Stand pose, on a transparent background. Skin, face, eyebrows, underwear, beard and eyes are composited and textured from the game's own data.
- Below it, the page names the product and build, counts how many of the build's files are on disk, says whether high-res textures are installed, and reads a table, a model and a texture as a check.
- The 34 database tables the character and gear pipeline needs match wago.tools' export of the same build cell for cell. Sections encrypted with unpublished keys are skipped and counted (69 of 19,293 items in this build).
- The only thing fetched from the network after the folder is given is the table definitions, from wowdev/WoWDBDefs on GitHub.

Known to be wrong or missing:

- Face options reshape the face with bone sets; those are not applied, so every face has the base shape. The page says so under the picture.
- The lighting has not been compared with the game yet.
- No other race or sex, no appearance choices, no gear, no pose choice, no export.

Not yet tested: Edge, Windows, other browsers, and any other WoW product. Encrypted data with published keys is not decrypted yet (this build has none).

Chrome's newer folder picker (`showDirectoryPicker`) is not used: it refuses anything inside `/Applications` or `Program Files`, which is where the game installs. The cost is that the page cannot remember the folder between visits.

## Development

```bash
pnpm install
pnpm dev      # local dev server
pnpm test     # unit tests, plus tests against a game install
pnpm e2e      # the built page in Google Chrome, network off, against a game install
pnpm build    # type-check and build to dist/
```

Tests that need a game install look for it at `WOW_DIR` (default `/Applications/World of Warcraft`) and report as skipped when it is absent.

## Credits

The file reading (CASC, BLTE, root, database tables, models, skins, textures), the shader combiner table and the appearance data relationships follow [wow.export](https://github.com/Kruithne/wow.export) (MIT, Kruithne and Marlamin) and [wowdev.wiki](https://wowdev.wiki). Table definitions come from [WoWDBDefs](https://github.com/wowdev/WoWDBDefs) at run time.

## Licence

MIT. See [LICENSE](LICENSE).

Mogshot is a fan project. It is not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft is a trademark of Blizzard Entertainment, Inc. No Blizzard files are stored in this repository or on the site.
