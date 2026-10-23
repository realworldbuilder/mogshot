# Mogshot

A web page that turns a World of Warcraft character into a transparent PNG, using the game files already on your computer. Free, no account, no server. Your game files are read in your browser and never leave your machine.

Site: https://realworldbuilder.github.io/mogshot/

## Status

This section is updated as things actually work; it lists nothing that doesn't.

What works today, in Chrome on a Mac, against WoW build 1.60.1.70170 (`wow_classic_beta`):

- Drag your World of Warcraft folder onto the page, or choose it with the button. The first visit reads the install's index (a few seconds); later visits reopen it from a cache in the browser in well under a second, and work offline.
- The Character tab is laid out like the game's character creation screen: the Alliance races down the left, the Horde down the right, Male and Female at the top, the classes along the bottom with the ones the race cannot be dimmed, and the character in the middle, filling the window. The race and class pictures are the game's own, read from its interface atlas. The look, gear, pose, place, backdrop, title and clip controls are in panels opened from the bar at the bottom; the size, Copy and Download PNG are on the bar itself.
- Pick a race and sex from the ones the game lets you create (ten races in this build), and set each appearance option the character creation screen offers. Colour options are swatches in the game's colours. The character is drawn from the game's own data on a transparent background: skin, face, hair, facial hair, eyes, underwear, face shapes, and the jewellery and other pieces some races add.
- Shortcuts: a random look (a random choice for every appearance option), a random outfit of epics in every armour slot and the hands, the best set for a class the race can be (or any set from the list) with a weapon to match, and a clear button.
- Picture your own characters: a small addon (in [addon/Mogshot](addon/Mogshot)) remembers each character's race, sex, class and worn items, and their appearance choices once they visit a barber. The page finds that file inside the folder you drop and lists your characters; pick one and it is drawn in its gear. `/mogshot` in the game also shows a code to paste into the page. A face set by eye is kept for that character across imports. Whatever cannot be placed is said in words: items not in the data, a bow when both hands are full, choices from another race.
- Dress the character: each of the thirteen visible slots (head, shoulders, back, chest, shirt, tabard, wrists, hands, waist, legs, feet, main hand, off hand) has a search by name with the items' icons. Armour is painted and shaped on the body, helms, shoulders, weapons and shields are attached, a held weapon closes the hand, and glows face the camera.
- Pose it: eleven curated poses (Stand, Ready, Attack, Cast, Roar, Cheer, Point, Flex, Salute, Wave, Kneel; Ready and Attack follow the weapon held), or pick any of the model's animations and scrub to a moment of it.
- Film it: Play runs the animation on screen in a loop with the camera held steady. Download clip saves one pass of it, or about 5, 10, 15 or 30 seconds of it played over, always ending where it began, as an MP4 video (H.264 in standard colour with a silent sound track, 30 frames a second, up to 1080p in the picture's shape; the Reel or Story size gives 1080 × 1920), a GIF (25 frames a second, up to 800 pixels), or a zip of transparent PNG frames for an editor. Video and GIF cannot be transparent: with no backdrop their background is black.
- Stand it somewhere: Place puts the character in the game world itself, read from your files: the ground with its textures, water, buildings (Stormwind is one), and the trees, lamps and other props around, under a plain sky, with a soft shadow at the feet and the distance blurred (a slider). Two spots are built in; for your own, stand there in the game, type `/mogshot spot`, and paste the line it prints. The facing slider turns the character; the camera orbits as before. Works in stills and clips.
- Title it: a line of words and a smaller second line, at the top or the bottom, laid over the picture and over every frame of a clip, and shown over the preview. Yellow and white with a dark edge, in a serif font the computer already has (Palatino on a Mac), so the letters can differ from one machine to another. Long titles wrap to three lines, then shrink. On a Reel or Story the words keep clear of the top and bottom edges, where phone apps put their own buttons; that distance is a rule of thumb and has not been checked in Instagram. A tight crop is saved without a title.
- Frame it: drag to turn, shift-drag to slide, scroll to zoom, a lens slider from flat to wide, and a reset. The view always starts framed on the character.
- Save it: a tight 4K crop, 4K, 1080p, a YouTube thumbnail or a square, as a transparent PNG with straight alpha, downloaded or copied to the clipboard. The preview has the shape of the picture that will be saved.
- Put a backdrop behind it: a colour, one of eight gradients or your own two colours (as a spotlight or top to bottom), or one of the game's own loading screens, picked by zone or instance name and read from your install; blur and vignette sliders. The backdrop is drawn under the character, so glows blend into it exactly, and the picture is saved uncropped at the preset's size. "Backdrop only" saves the backdrop by itself, to layer under a transparent character in Canva.
- The Backdrop tab at the top of the page makes a backdrop by itself, with a large preview, six sizes (including portrait and story), download and copy. Colours and gradients work before any folder is opened; the loading screens appear once the folder is. The backdrop is shared with the Character tab, and `#backdrop` in the address opens the tab.
- The page remembers the last character, gear, pose, size, backdrop and title for the next visit.
- If something a character or an item needs cannot be read, the page lists it by name under the download button, before you download.
- The page shows the product and build it found, how many of the build's files are on disk, and whether high-res textures are installed.
- The addon: copy `addon/Mogshot` into `_classic_beta_/Interface/AddOns/` or `_retail_/Interface/AddOns/` (one copy loads in both; on retail it also records the transmog each slot shows), log in to each character, and type `/reload` (the game writes the file on `/reload` or logout), then drag the folder onto the page again.
- NPCs on the command line: `"npc": 7274` draws a creature display as the game draws it, Tyrande Whisperwind for one: a humanoid NPC takes its player race and sex, its appearance choices, its gear (by item look rather than by item) and its painted body texture from the creature tables, and keeps every pose, clip, place, title and backdrop a player gets. An NPC can be named where the game knows the name: the pets the files list, and the NPCs this computer has seen in the game (read from the client's creature cache); `mogshot npcs <words>` lists them. A creature with a model of its own (a beast, an elemental, a pet) is drawn from that model with the display's textures and the game's scale; it has no choices or gear, and a model that keeps variants (a saddle, a second set of horns) as sections shows them all. Checked on Tyrande, a Living Flame and a Mechanical Squirrel only; the slot numbers of NPC gear other than head, shirt, legs and hands are unverified.
- Retail's transmog sets on the command line (18 Oct 2026, build 12.1.5.70448): `mogshot transmogsets [words]` lists the named sets of the game's Appearances tab (4,900 or so: raid tiers in each difficulty's colour, PvP seasons, heritage armour, dungeon, Trading Post and world sets), filtered by `--class`, `--kind`, `--label` and `--expansion`. `"set": { "name": "Judgment Armor" }` or `{ "id": 901 }` without a class dresses the character in one, each piece in the set's own look, and `"label": "Mythic"` picks a variant. A gear slot can also take `{ "source": n }`, an appearance source, to wear one piece of another set in its colour. Checked on Judgment Armor (paladin T2) on a human, Heritage of the Sin'dorei on a blood elf, and Cosmic Penitent's Raiment (Mythic) on a night elf. Whether a set is raid, PvP, heritage or dungeon is guessed from its name and label; sets carry no weapons.
- The 45 database tables the character, gear, NPC, backdrop and portrait pipeline needs match wago.tools' export of the same build cell for cell. Sections encrypted with unpublished keys are skipped and counted (69 of 19,293 items in this build).
- The only thing fetched from the network is the table definitions, from wowdev/WoWDBDefs on GitHub, kept in the browser after the first visit.

Known to be wrong or missing:

- Nothing has been compared with the game side by side yet: lighting, skin tones, face shapes and how gear sits are unverified. See [docs/golden](docs/golden/README.md).
- Glowing (additive) parts get their transparency from their brightness. That is exact over black or over a backdrop chosen on the page, and an approximation over anything else a transparent picture is laid on.
- The classic loading screens are 512 × 512 files (three are 1024 × 1024) that the game stretches to 4:3, with a parchment frame and the game's logo painted over the top of the art. The page shows the band of art below the logo, stretched as the game does, cropped to the picture's shape; the bottom of a large logo can still show, and the art is soft at anything above 720p. The eight newer screens are 2992 × 1684 and sharp. Screens the build lists but the install lacks are left out.
- Places are a first version. Not drawn: water that belongs to a building (Stormwind's moat and canals show their dry beds), the game's real sky, clouds, weather and time of day (the light is a fixed mid-morning sun), shadows cast by buildings, anything that moves (flags, fountains, flames, people, animals), and props whose skeleton is in a separate file. Rooms are lit evenly, not by their lamps. The ground blends its textures plainly, not by height as the game does. Seen from outdoors, rooms more than 80 yards off are left out, so distant doorways show sky. The game does not tell addons the height or any position inside dungeons: a spot lands on the lowest floor above the earth, which under a bridge or on an upper storey is the wrong one (the command line takes a `z`). Nothing stops the camera passing through walls. Tried in Stormwind and Elwynn only.
- Particle and ribbon effects on items (trails, sparks, enchant glows) are not drawn, and item animations stay at their first frame.
- The faction crests and the Male and Female signs are drawn by the page, not taken from the game: the game's crest art is in the same atlas, but its names have not been checked. If the atlas cannot be read, the rings show the races' and classes' initials and a line under the sex buttons says why. Arrow keys do not move between races, sexes or classes yet; Tab does.
- A title has one look: its font, colours and size cannot be chosen, and it sits in the middle of the line. A title at the bottom of a Reel lies over the character's legs unless the camera is moved.
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
  { "out": "dance.mp4", "race": "Tauren", "sex": "male", "clip": { "animation": "EmoteDance" }, "backdrop": "Frost" },
  { "out": "tyrande.png", "npc": 7274, "pose": "Cast" }
]
```

A spec names a race and sex, a character the addon saved, or an NPC (a creature display id, or a name the game knows), and optionally appearance choices, a class set, items by name or id, a pose or a moment of an animation, the camera, a size, a backdrop, a title, and a place in the game world to stand in. With `"clip": true` it is filmed instead: a looping clip of the pose's animation (or one named, or a number of seconds; `"loop": true` rounds the seconds to whole passes so the end meets the start), saved by the ending of `out` as `.mp4`, `.gif` or `.zip` (PNG frames). `"to"` inside `clip` is a second camera: the view moves from `camera` to it over the clip, for a slow turn or a push in. `"empty": true` inside `place` draws the place with nobody in it. The moving camera and the empty place are on the command line only. An NPC is drawn as the game draws it, so `race`, `sex` and `character` are left out; `gear` and `set` replace its gear slot by slot. `pnpm mogshot help` lists every field; `races`, `options`, `poses`, `items`, `sets`, `backdrops`, `sizes`, `characters` and `npcs` list what can be named. Everything is printed as JSON, with each picture's problems. A name that cannot be placed is an error that lists what there is, not a guess.

Node reads the game folder (`--wow <folder>` or `WOW_DIR`, default `/Applications/World of Warcraft`) and builds the character; installed Chrome, run without a window, draws it with the page's own renderer. Tried on one Mac only. A first run reads the install's index; after that a picture takes one to three seconds. `--product wow` (or `WOW_PRODUCT`) picks retail when the folder holds several games; `mogshot products` lists them. A folder on another computer is read through ssh with `--wow host:/path` (Python 3 on that computer, nothing else), and what it reads from the archives is kept on this one.

```
pnpm mogshot export shots.json
```

The same spec with `"out"` ending `.glb` writes the character as a glTF binary for Blender and other 3D tools: the meshes with the textures Mogshot composited (skin, hair and gear baked), a skeleton, and animations baked frame by frame from the poses the renderer draws. `"animations"` names the ones to bake (a list, or `"all"`; without it, the pose's own and Stand), `"fps"` the rate (30). Only the vertices the character draws are kept. The skeleton is flat (every bone a root, as the game's matrices are), so a tool poses the model exactly as Mogshot does but has no parent chain to drag by hand. Blender's built-in glTF importer reads it; no add-on. A character with eight animations is about 7 MB and takes under a second.

## Transmogify

A page for dressing retail characters, served from the computer that runs it:

```
pnpm transmogify
```

It listens on port 4190 (127.0.0.1 and the tailnet address; `TRANSMOGIFY_PORT`, `TRANSMOGIFY_HOSTS`) and reads the game through `WOW_DIR` and `WOW_PRODUCT` (default: retail on williams-macbook-pro-2 over ssh). The transmog sets are on the left: race, sex and class, a search of the sets with filters for kind, expansion and class, and each set's difficulties and colours as buttons. The slots stand around the character as on the game's character pane, with the game's own empty-slot pictures (Interface/PaperDoll): head to wrists down the left, hands to trinkets down the right, the weapons along the bottom. Each is framed in its item's quality colour, shows the game's kind of tooltip, and opens an item search over the picture; neck, rings and trinkets are there for the shape but dimmed, since nothing on a model shows them. The character is in the middle, drawn live in the browser by the same renderer and idling in its pose's animation: drag to turn it as on the character select screen (a flick keeps it turning), drag with the right button, with shift held or with two fingers to move the view, scroll or pinch to zoom, double-click to reset. Face holds the view on the head (the model's helm attachment point, which the scene now carries as `head`) at head-and-shoulders size for a profile picture, and keeps it there as the character turns or changes clothes; Full body goes back. The renderer's `aimAt` works out the zoom and pan for that, in the same numbers the command line's camera takes. The server builds the scene and one pass of the animation and sends them packed and gzipped (2 to 6 MB a look, kept by spec), and `transmogify/live.ts` is bundled at start. Poses and backdrops are buttons under it; Save and PNG draw the picture at the angle on screen. Random puts on one of the class's own sets (Set), a piece from a different class set in each slot in that set's look (Mix pieces), or any race, class and set (Anyone), each with weapons the class carries, keeping the view; Roll 6 draws three sets and three mixes into the grid. Save draws a 2160 × 2160 picture with its spec into `TRANSMOGIFY_SAVE`. The composer is on the right: a request in words ("6 night elf druid mogs in purple and silver") goes to `claude -p`, which searches the sets and items through the page's own API, checks each spec, and gives back looks that are drawn in a grid; one click puts a look on the page to change. Its specs are checked again before they are drawn and sent back once to be fixed. Pictures are drawn the command line's way in one Chrome kept open, about a second each, and kept by spec. On a phone the three columns are tabs.

Known to be missing: the composer cannot see colours, so "purple" is matched by set names only; a set's pieces list does not show which variant's look the icons are; the page has no clip or place controls; a browser without WebGL 2 gets still pictures from the server instead of the live view.

## Discord bot

Mogshot in a Discord chat: `/mog` draws a character and posts the picture.

```
pnpm mogbot register   # once, after the token is in ~/.config/wfg/mogbot.env
pnpm mogbot            # run the bot
```

`/mog` takes `race` and `sex`, `set` (a retail transmog set or a classic class set, by name, with autocomplete from the same tables as `mogshot transmogsets` and `mogshot sets`), `pose` (the eleven curated poses), `backdrop` (the eight gradients, Slate unless said, or transparent), `clip` (a looping MP4 of the pose's animation instead of a picture: one pass, 1080 square, at most 10 seconds), `product` (classic unless said, or retail) and `code` (a MOG code from `/mogshot` in the game, drawn as worn). The bot answers inside Discord's three seconds, draws through `bin/mogshot.mjs render` one picture at a time, and edits its answer with the file and a line saying race, sex, set and pose, or with what could not be placed, in the command line's own words. One render per person at a time, and twenty an hour. The command is registered globally and the app installs to a server or to a person's account, so `/mog` works in any server, in a DM with the bot and in group DMs.

It is configured by `~/.config/wfg/mogbot.env`, which is not in git: `DISCORD_TOKEN` and `DISCORD_APP_ID` from the developer portal, `WOW_DIR` and `WOW_PRODUCT` for classic (the command line's defaults), and `WOW_DIR_RETAIL` for retail (the MacBook over ssh unless said). The autocomplete lists are read once into `node_modules/.cache/mogbot/catalog.json`; `pnpm mogbot catalog` rebuilds them after a game update. `pnpm mogbot try 'race="Night Elf" sex=female set="Judgment Armor" product=retail'` draws one picture the way `/mog` would, without Discord, to `mogbot-try.png` (`--out` names another file; `clip=true` makes an MP4). On the Mac mini the bot runs under launchd as `com.william.mogbot`, logging to `~/Library/Logs/mogbot.log`.

A clip with a transparent backdrop has a black background, as every video does. Everything the Status section says the renderer cannot draw holds here too.

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
