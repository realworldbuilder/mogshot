# Mogshot

A web page that turns a World of Warcraft character into a transparent PNG, using the game files already on your computer. Free, no account, no server. Your game files are read in your browser and never leave your machine.

Site: https://realworldbuilder.github.io/mogshot/

## Status

This section is updated as things actually work; it lists nothing that doesn't.

What works today, in Chrome on a Mac, against WoW build 1.60.1.70170 (`wow_classic_beta`):

- Drag your World of Warcraft folder onto the page, or choose it with the button. The first visit reads the install's index (a few seconds); later visits reopen it from a cache in the browser in well under a second, and work offline.
- Pick a race and sex from the ones the game lets you create (ten races in this build), and set each appearance option the character creation screen offers. Colour options are swatches in the game's colours. The character is drawn from the game's own data on a transparent background: skin, face, hair, facial hair, eyes, underwear, face shapes, and the jewellery and other pieces some races add.
- Shortcuts: a random look (a random choice for every appearance option), a random outfit of epics in every armour slot and the hands, the best set for a class the race can be (or any set from the list) with a weapon to match, and a clear button.
- Picture your own characters: a small addon (in [addon/Mogshot](addon/Mogshot)) remembers each character's race, sex, class and worn items, and their appearance choices once they visit a barber. The page finds that file inside the folder you drop and lists your characters; pick one and it is drawn in its gear. `/mogshot` in the game also shows a code to paste into the page. A face set by eye is kept for that character across imports. Whatever cannot be placed is said in words: items not in the data, a bow when both hands are full, choices from another race.
- Dress the character: each of the thirteen visible slots (head, shoulders, back, chest, shirt, tabard, wrists, hands, waist, legs, feet, main hand, off hand) has a search by name with the items' icons. Armour is painted and shaped on the body, helms, shoulders, weapons and shields are attached, a held weapon closes the hand, and glows face the camera.
- Pose it: eleven curated poses (Stand, Ready, Attack, Cast, Roar, Cheer, Point, Flex, Salute, Wave, Kneel; Ready and Attack follow the weapon held), or pick any of the model's animations and scrub to a moment of it.
- Film it: Play runs the animation on screen in a loop with the camera held steady. Download clip saves one pass of it, which loops without a seam, as an MP4 video (H.264, 30 frames a second, up to 1080p in the picture's shape), a GIF (25 frames a second, up to 800 pixels), or a zip of transparent PNG frames for an editor. Video and GIF cannot be transparent: with no backdrop their background is black.
- Stand it somewhere: Place puts the character in the game world itself, read from your files: the ground with its textures, water, buildings (Stormwind is one), and the trees, lamps and other props around, under a plain sky, with a soft shadow at the feet and the distance blurred (a slider). Two spots are built in; for your own, stand there in the game, type `/mogshot spot`, and paste the line it prints. The facing slider turns the character; the camera orbits as before. Works in stills and clips.
- Frame it: drag to turn, shift-drag to slide, scroll to zoom, a lens slider from flat to wide, and a reset. The view always starts framed on the character.
- Save it: a tight 4K crop, 4K, 1080p, a YouTube thumbnail or a square, as a transparent PNG with straight alpha, downloaded or copied to the clipboard. The preview has the shape of the picture that will be saved.
- Put a backdrop behind it: a colour, one of eight gradients or your own two colours (as a spotlight or top to bottom), or one of the game's own loading screens, picked by zone or instance name and read from your install; blur and vignette sliders. The backdrop is drawn under the character, so glows blend into it exactly, and the picture is saved uncropped at the preset's size. "Backdrop only" saves the backdrop by itself, to layer under a transparent character in Canva.
- The Backdrop tab at the top of the page makes a backdrop by itself, with a large preview, six sizes (including portrait and story), download and copy. Colours and gradients work before any folder is opened; the loading screens appear once the folder is. The backdrop is shared with the Character tab, and `#backdrop` in the address opens the tab.
- The page remembers the last character, gear, pose, size and backdrop for the next visit.
- If something a character or an item needs cannot be read, the page lists it by name under the download button, before you download.
- The page shows the product and build it found, how many of the build's files are on disk, and whether high-res textures are installed.
- The addon: copy `addon/Mogshot` into `_classic_beta_/Interface/AddOns/`, log in to each character, and type `/reload` (the game writes the file on `/reload` or logout), then drag the folder onto the page again.
- The 39 database tables the character, gear and backdrop pipeline needs match wago.tools' export of the same build cell for cell. Sections encrypted with unpublished keys are skipped and counted (69 of 19,293 items in this build).
- The only thing fetched from the network is the table definitions, from wowdev/WoWDBDefs on GitHub, kept in the browser after the first visit.

Known to be wrong or missing:

- Nothing has been compared with the game side by side yet: lighting, skin tones, face shapes and how gear sits are unverified. See [docs/golden](docs/golden/README.md).
- Glowing (additive) parts get their transparency from their brightness. That is exact over black or over a backdrop chosen on the page, and an approximation over anything else a transparent picture is laid on.
- The classic loading screens are 512 × 512 files (three are 1024 × 1024) that the game stretches to 4:3, with a parchment frame and the game's logo painted over the top of the art. The page shows the band of art below the logo, stretched as the game does, cropped to the picture's shape; the bottom of a large logo can still show, and the art is soft at anything above 720p. The eight newer screens are 2992 × 1684 and sharp. Screens the build lists but the install lacks are left out.
- Places are a first version. Not drawn: water that belongs to a building (Stormwind's moat and canals show their dry beds), the game's real sky, clouds, weather and time of day (the light is a fixed mid-morning sun), shadows cast by buildings, anything that moves (flags, fountains, flames, people, animals), and props whose skeleton is in a separate file. Rooms are lit evenly, not by their lamps. The ground blends its textures plainly, not by height as the game does. Seen from outdoors, rooms more than 80 yards off are left out, so distant doorways show sky. The game does not tell addons the height or any position inside dungeons: a spot lands on the lowest floor above the earth, which under a bridge or on an upper storey is the wrong one (the command line takes a `z`). Nothing stops the camera passing through walls. Tried in Stormwind and Elwynn only.
- Particle and ribbon effects on items (trails, sparks, enchant glows) are not drawn, and item animations stay at their first frame.
- In the Stand pose a held weapon points forward; the Ready poses show it properly.
- Guild tabards have no emblem. Items that share a name and a look are listed once.
- The game tells an addon a character's skin, hair and face only while the barber window is open (checked on this build: the call answers nothing anywhere else). Each character sits in a barber chair once, without changing anything; until then an imported character has the default look or whatever was set by eye.
- Models that keep their skeleton in a separate file cannot be read. No race this build lets you create uses one; other WoW products do.
- The folder cannot be remembered between visits: Chrome's folder picker refuses `/Applications` and `Program Files`, where the game installs, so the page uses the older pickers, which cannot keep a folder. A return visit takes one drag or pick.

Not yet tested: Edge, Windows, other browsers, and any other WoW product. Encrypted data with published keys is not decrypted yet (this build has none).

## Command line

The same pictures and clips without the page, for scripts and assistants: write down what you want, get PNG files, or MP4, GIF and PNG-frame clips.

```
pnpm mogshot render shots.json
```

```json
[
  { "out": "rambleon.png", "character": "Rambleon", "pose": "Ready" },
  { "out": "warrior.png", "race": "Orc", "sex": "male", "set": { "class": "Warrior" }, "pose": "Roar",
    "camera": { "yaw": 20 }, "size": "square", "backdrop": "Ember" },
  { "out": "dance.mp4", "race": "Tauren", "sex": "male", "clip": { "animation": "EmoteDance" }, "backdrop": "Frost" }
]
```

A spec names a race and sex or a character the addon saved, and optionally appearance choices, a class set, items by name or id, a pose or a moment of an animation, the camera, a size, a backdrop, and a place in the game world to stand in. With `"clip": true` it is filmed instead: a looping clip of the pose's animation (or one named, or a number of seconds), saved by the ending of `out` as `.mp4`, `.gif` or `.zip` (PNG frames). `pnpm mogshot help` lists every field; `races`, `options`, `poses`, `items`, `sets`, `backdrops`, `sizes` and `characters` list what can be named. Everything is printed as JSON, with each picture's problems. A name that cannot be placed is an error that lists what there is, not a guess.

Node reads the game folder (`--wow <folder>` or `WOW_DIR`, default `/Applications/World of Warcraft`) and builds the character; installed Chrome, run without a window, draws it with the page's own renderer. Tried on one Mac only. A first run reads the install's index; after that a picture takes one to three seconds.

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
