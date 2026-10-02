# Mogshot

A web page that turns a World of Warcraft character into a transparent PNG, using the game files already on your computer. Free, no account, no server. Your game files are read in your browser and never leave your machine.

Site: https://realworldbuilder.github.io/mogshot/

## Status

This section is updated as things actually work; it lists nothing that doesn't.

What works today, in Chrome on a Mac, against WoW build 1.60.1.70170 (`wow_classic_beta`):

- Drag your World of Warcraft folder onto the page, or choose it with the button.
- Pick a race and sex from the ones the game lets you create (ten races in this build), and set each appearance option the character creation screen offers. The character is drawn from the game's own data in the Stand pose on a transparent background: skin, face, hair, facial hair, eyes, underwear, face shapes, and the jewellery and other pieces some races add.
- Dress the character: each of the thirteen visible slots (head, shoulders, back, chest, shirt, tabard, wrists, hands, waist, legs, feet, main hand, off hand) has a search by name with the items' icons. Armour is painted and shaped on the body, helms, shoulders, weapons and shields are attached, a held weapon closes the hand, and glows face the camera. Gear stays on when you change race or sex.
- Pose it: eleven curated poses (Stand, Ready, Attack, Cast, Roar, Cheer, Point, Flex, Salute, Wave, Kneel; Ready and Attack follow the weapon held), or pick any of the model's animations and scrub to a moment of it. The pose stays when the race, looks or gear change.
- Frame it: drag to turn, shift-drag to slide, scroll to zoom, a lens slider from flat to wide, and a reset. The view always starts framed on the character.
- Save it: a tight 4K crop, 4K, 1080p, a YouTube thumbnail or a square, as a transparent PNG with straight alpha, downloaded or copied to the clipboard. The preview has the shape of the picture that will be saved.
- If something a character or an item needs cannot be read, the page lists it by name under the download button, before you download.
- The page shows the product and build it found, how many of the build's files are on disk, and whether high-res textures are installed.
- The 36 database tables the character and gear pipeline needs match wago.tools' export of the same build cell for cell. Sections encrypted with unpublished keys are skipped and counted (69 of 19,293 items in this build).
- The only thing fetched from the network after the folder is given is the table definitions, from wowdev/WoWDBDefs on GitHub.

Known to be wrong or missing:

- Nothing has been compared with the game side by side yet: lighting, skin tones, face shapes and how gear sits are unverified.
- Colour options (skin, hair, eyes) are listed as numbers, not swatches.
- Glowing (additive) parts get their transparency from their brightness. That is exact over black and an approximation over anything else.
- Particle and ribbon effects on items (trails, sparks, enchant glows) are not drawn.
- In the Stand pose a held weapon points forward; the Ready poses show it properly.
- Item animations (a weapon's own idle motion) stay at their first frame.
- Guild tabards have no emblem. Items that share a name and a look are listed once.
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
