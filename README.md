# Mogshot

A web page that turns a World of Warcraft character into a transparent PNG, using the game files already on your computer. Free, no account, no server. Your game files are read in your browser and never leave your machine.

Site: https://realworldbuilder.github.io/mogshot/

## Status

This section is updated as things actually work; it lists nothing that doesn't.

What works today, in Chrome on a Mac, against WoW build 1.60.1.70170 (`wow_classic_beta`):

- Drag your World of Warcraft folder onto the page, or choose it with the button.
- Pick a race and sex from the ones the game lets you create (ten races in this build), and set each appearance option the character creation screen offers. The character is drawn from the game's own data in the Stand pose on a transparent background: skin, face, hair, facial hair, eyes, underwear, face shapes, and the jewellery and other pieces some races add.
- Download PNG saves the picture as a transparent PNG, 3840 pixels on its longer side, supersampled, with straight (not premultiplied) alpha. It can be cropped tightly to the character. On the development machine this takes under a second.
- If something a character needs cannot be read, the page lists it beside the picture.
- The page shows the product and build it found, how many of the build's files are on disk, and whether high-res textures are installed.
- The 35 database tables the character and gear pipeline needs match wago.tools' export of the same build cell for cell. Sections encrypted with unpublished keys are skipped and counted (69 of 19,293 items in this build).
- The only thing fetched from the network after the folder is given is the table definitions, from wowdev/WoWDBDefs on GitHub.

Known to be wrong or missing:

- Nothing has been compared with the game side by side yet: lighting, skin tones and face shapes are unverified.
- Colour options (skin, hair, eyes) are listed as numbers, not swatches.
- Glowing (additive) parts get their transparency from their brightness. That is exact over black and an approximation over anything else.
- No gear, no pose or camera choice, no size presets.
- Models that keep their skeleton in a separate file cannot be read. No race this build lets you create uses one; other WoW products do.

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
