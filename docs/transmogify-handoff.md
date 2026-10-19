# Transmogify: handoff prompt (19 Oct 2026)

Paste everything below the line into the next coding session, opened in `~/projects/wow-creator-suite` on the Mac mini.

---

You're picking up **Transmogify**, a web app inside Mogshot (`~/projects/wow-creator-suite`). It dresses retail World of Warcraft characters in transmog, using the real game files. It's live at http://100.76.214.19:4190 (tailnet: William opens it from his MacBook and iPhone). Read `README.md` (the Status section and "## Transmogify") and `docs/transmogify-brief.md` first.

**Where things are**
- `src/character/transmog.ts`: the transmog set catalog (TransmogSet, TransmogSetItem flag 1 = the set's own piece, ItemNameDescription labels). `cli/spec.ts`: `"set": {"name"|"id","label"}` with no class wears one; gear takes `{"source": n}`.
- `cli/transmogify.ts`: the server. It keeps one retail Session over ssh to the MacBook and one headless Chrome. Endpoints: `/api/sets`, `/api/items`, `/api/options`, `/api/render` (PNG, cached by spec hash), `/api/live` (packed and gzipped scene plus an idle loop for the browser), `/api/random` (set / mix / anyone), `/api/compose` (headless `claude -p --model sonnet --json-schema`, allowed `Bash(curl:*)` against its own API), and `/api/save`, which writes a 2160² PNG and its spec to `~/projects/wow-forever-guide/content/images/retail/transmogify/`, served at http://100.76.214.19:4180/images/retail/transmogify/.
- `bin/transmogify.mjs`: starts it. It bundles `transmogify/live.ts` with Vite to `/live.js` and serves the render harness on 127.0.0.1:4191.
- `transmogify/`: the page, vanilla JS (`app.js`), plus `live.ts`, the live 3D viewer built on `CharacterRenderer`. Pan, zoom and the Face mode follow `scene.head` through `renderer.aimAt`.
- launchd: `com.william.transmogify`, logging to `transmogify.log`. Restart after any change in cli/, src/ or live.ts: `launchctl kickstart -k gui/$(id -u)/com.william.transmogify`. The page files under transmogify/ are served fresh, but live.ts is bundled at start.

**Facts that bite**
- Retail exists only on the MacBook (`--wow "williams-macbook-pro-2:/Applications/World of Warcraft" --product wow`), and the MacBook has to be awake. While Battle.net patches, every read misses the cache.
- Camera `zoom` is a distance factor: smaller is closer. Pan is in fractions of the view's half height.
- Retail quirks: Void Elf has only the Stand pose, the Void Elf DH set draws a floating copy, Nightborne has no Cast pose, and particles and enchant glows aren't drawn. A held weapon in Stand points forward.
- `samples/` is 58 MB of untracked video. Never commit it.
- Style: plain, concrete README sentences in the existing voice, comments that say why, and commit messages that end with the Co-Authored-By line. Typecheck with `npx tsc --noEmit -p .` and run `pnpm test` (228 tests). Check UI work by driving the page with Playwright (`@playwright/test` with `channel: 'chrome'`) and looking at screenshots at 1440×900 and 390×844. Commit only when William asks.

**What to build next, best first**
1. **Colour-aware sets.** The composer can't see colour, so "purple and silver" only matches names. Work out each set's main colours once, from its item icons or better its textures, cache them, and add a colour filter (swatches) to the set list and a `colour=` parameter to `/api/sets?brief` for the composer.
2. **Lock and reroll.** A lock on each paper doll slot, so Random and Mix only change the unlocked slots (keep the helm, reroll the rest).
3. **Turntable export.** A "Spin" button that saves a 360° MP4 or GIF at the current framing (the CLI clip already supports `"clip"` with `"to": {"yaw": ...}`). Reel size 1080×1920, for Instagram.
4. **Vote carousel.** Pick 2 to 4 looks from the grid and export one "which mog?" image in 1080×1350 portrait (William's carousel format).
5. **Paste a character.** A box that takes a MOG2 code from the Mogshot addon (his retail main Scarletfire is a female night elf druid; her look choices are in `~/projects/wow-forever-guide/content/shots-retail-scarletfire-v2.json`) and loads that character's gear and transmog.
6. **Share links.** The spec in the URL hash, so a look opens from a link, plus a saved-looks gallery on the page reading the save folder.
7. **Profile picture extras.** A circle or rounded-square crop preview on Face, transparent background, and Discord, Twitch and X avatar sizes.

Start with item 1 unless William says otherwise. When done, tell him the one link to try (http://100.76.214.19:4190) and what changed.
