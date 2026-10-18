# Transmogify: brief (18 Oct 2026)

A web app for dressing retail WoW characters: the transmog catalog in a left sidebar, the character in the middle, an AI composer in a right sidebar. Build it in two stages and check each before the next.

## Stage 1: retail transmog set catalog (engine + CLI)
- Read TransmogSet, TransmogSetItem and TransmogSetGroup from retail, together with ItemModifiedAppearance (src/character/equipment.ts already uses it for the addon's 8th code field).
- `mogshot transmogsets <words> [--class X]` lists each set's id, name, expansion, class mask and difficulty or colour variant.
- Spec field `"set": {"name": "..."}` or `{"id": N}` dresses the character slot by slot from the set's appearance sources, using the addon's transmog path. Today's `"set": {"class": ...}` keeps working.
- Covers heritage armour and the old tiers (T1 to T3).
- Check: renders of Judgement (paladin T2) on a human, one heritage set, and one Midnight set in its mythic colour, saved to ~/projects/wow-forever-guide/content/images/retail/sets/ (served at http://100.76.214.19:4180/images/retail/sets/).

## Stage 2: the web app
- A Node server here (`pnpm transmogify`) on the mini, listening on 127.0.0.1 and 100.76.214.19 at port 4190 (4180, 4200, 4300 and 4400 are taken). It keeps one Session open on retail over ssh and renders with the CLI's headless Chrome pipeline.
- Three columns on desktop; on a phone the sidebars become tabs or drawers.
  - Left, transmog: race, sex and class; set search with filters (class or armour type, expansion, tier/PvP/heritage/dungeon, colour variant); click a set to dress; per-slot item search with icons; pose; backdrop.
  - Middle: the preview. Server-rendered PNGs cached by spec hash to start with. A live 3D orbit, streaming game bytes to the browser so the Preact Viewer can draw it, only if that turns out cheap.
  - Right, AI composer: a chat box. A request ("12 night elf druid mogs in purple and silver", "paladin through every tier") becomes specs through headless `claude -p` with a JSON schema. It may only name real sets and items: a catalog search tool, or validate and retry. Results come back as a grid; clicking one loads it into the left sidebar.
- Actions: download PNG, save the spec and PNG to ~/projects/wow-forever-guide/content/images/retail/transmogify/, copy the spec.
- Use the page's existing style (src/app/style.css).
- Done: the app runs at http://100.76.214.19:4190, a composer request gives a grid of correct renders, and the README Status section has an entry.

## Facts
- Retail is only on the MacBook: `--wow "williams-macbook-pro-2:/Applications/World of Warcraft" --product wow`, and the MacBook must be awake.
- Known problems: Void Elf has only the Stand pose, the Void Elf DH set draws a floating copy, Nightborne has no Cast pose, particles are not drawn, and a MOG2 code carries no face until a barber visit.
- Scarletfire's look choices: ~/projects/wow-forever-guide/content/shots-retail-scarletfire-v2.json (worth a preset).
