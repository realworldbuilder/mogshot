# Mogshot

A web page that turns a World of Warcraft character into a transparent PNG, using the game files already on your computer. Free, no account, no server. Your game files are read in your browser and never leave your machine.

Site: https://realworldbuilder.github.io/mogshot/

## Status

This section is updated as things actually work; it lists nothing that doesn't.

What works today, in Chrome on a Mac, against WoW build 1.60.1.70170 (`wow_classic_beta`):

- Drag your World of Warcraft folder onto the page, or choose it with the button. The first visit reads the install's index (a few seconds); later visits reopen it from a cache in the browser in well under a second, and work offline.
- Pick a race and sex from the ones the game lets you create (ten races in this build), and set each appearance option the character creation screen offers. Colour options are swatches in the game's colours. The character is drawn from the game's own data on a transparent background: skin, face, hair, facial hair, eyes, underwear, face shapes, and the jewellery and other pieces some races add.
- Shortcuts: a random look (a random choice for every appearance option), a random outfit of epics in every armour slot, the best set for a class the race can be (or any set from the list), and a clear button.
- Picture your own characters: a small addon (in [addon/Mogshot](addon/Mogshot)) remembers each character's race, sex, class and worn items, and their appearance choices once they visit a barber. The page finds that file inside the folder you drop and lists your characters; pick one and it is drawn in its gear. `/mogshot` in the game also shows a code to paste into the page. A face set by eye is kept for that character across imports. Whatever cannot be placed is said in words: items not in the data, a bow when both hands are full, choices from another race.
- Dress the character: each of the thirteen visible slots (head, shoulders, back, chest, shirt, tabard, wrists, hands, waist, legs, feet, main hand, off hand) has a search by name with the items' icons. Armour is painted and shaped on the body, helms, shoulders, weapons and shields are attached, a held weapon closes the hand, and glows face the camera.
- Pose it: eleven curated poses (Stand, Ready, Attack, Cast, Roar, Cheer, Point, Flex, Salute, Wave, Kneel; Ready and Attack follow the weapon held), or pick any of the model's animations and scrub to a moment of it.
- Frame it: drag to turn, shift-drag to slide, scroll to zoom, a lens slider from flat to wide, and a reset. The view always starts framed on the character.
- Save it: a tight 4K crop, 4K, 1080p, a YouTube thumbnail or a square, as a transparent PNG with straight alpha, downloaded or copied to the clipboard. The preview has the shape of the picture that will be saved.
- The page remembers the last character, gear, pose and size for the next visit.
- If something a character or an item needs cannot be read, the page lists it by name under the download button, before you download.
- The page shows the product and build it found, how many of the build's files are on disk, and whether high-res textures are installed.
- The addon: copy `addon/Mogshot` into `_classic_beta_/Interface/AddOns/`, log in to each character, and type `/reload` (the game writes the file on `/reload` or logout), then drag the folder onto the page again.
- The 37 database tables the character and gear pipeline needs match wago.tools' export of the same build cell for cell. Sections encrypted with unpublished keys are skipped and counted (69 of 19,293 items in this build).
- The only thing fetched from the network is the table definitions, from wowdev/WoWDBDefs on GitHub, kept in the browser after the first visit.

Known to be wrong or missing:

- Nothing has been compared with the game side by side yet: lighting, skin tones, face shapes and how gear sits are unverified. See [docs/golden](docs/golden/README.md).
- Glowing (additive) parts get their transparency from their brightness. That is exact over black and an approximation over anything else.
- Particle and ribbon effects on items (trails, sparks, enchant glows) are not drawn, and item animations stay at their first frame.
- In the Stand pose a held weapon points forward; the Ready poses show it properly.
- Guild tabards have no emblem. Items that share a name and a look are listed once.
- The addon captures appearance choices only through the barber window, and only if this build has `C_BarberShop`; until then the look of an imported character is the default or whatever was set by eye.
- Models that keep their skeleton in a separate file cannot be read. No race this build lets you create uses one; other WoW products do.
- The folder cannot be remembered between visits: Chrome's folder picker refuses `/Applications` and `Program Files`, where the game installs, so the page uses the older pickers, which cannot keep a folder. A return visit takes one drag or pick.

Not yet tested: Edge, Windows, other browsers, and any other WoW product. Encrypted data with published keys is not decrypted yet (this build has none).

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
