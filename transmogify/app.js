// Transmogify's page. State is a Mogshot spec in pieces; every change builds the character again
// on the server, and the live view (live.ts) draws it here to be turned by hand.

import { Live, webglWorks } from './live.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
};

async function get(path) {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}
async function post(path, data) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

const SCARLETFIRE = {
  race: 'Night Elf', sex: 'female', cls: 'Druid',
  choices: { 'Hair Style': 'Braided Tails', 'Hair Color': 15, 'Vine Color': 1, 'Skin Color': 3, 'Markings Color': 6, 'Tattoo Color': 5, 'Eye Color': 1, Necklace: 'Choker', Eyebrows: 'Wild' },
};
const IDEAS = [
  '6 night elf druid mogs in purple and silver',
  'One paladin through every Classic and Burning Crusade tier',
  'Every heritage set on its own race',
  '4 gladiator warriors from different seasons',
  'Scarletfire in 4 Midnight sets',
];
const KINDS = [['', 'All'], ['raid', 'Raid'], ['pvp', 'PvP'], ['heritage', 'Heritage'], ['dungeon', 'Dungeon'], ['other', 'Other']];

const DEFAULT = { race: 4, sex: 'female', cls: 'Druid', choices: {}, set: null, gear: {}, pose: 'Stand', backdrop: 'Ember', yaw: 0, zoom: 1, panX: 0, panY: 0, kind: '', expansion: '', myClass: true, q: '' };
const state = (() => {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem('transmogify') ?? '{}') };
  } catch {
    return { ...DEFAULT };
  }
})();
const keep = () => {
  try {
    localStorage.setItem('transmogify', JSON.stringify(state));
  } catch {}
};

let meta;
let report;
let options = [];
/** The set picked from the list, for its variants. */
let activeSet;
let composerSession;
/** The live view, where the browser can draw it; else the page shows pictures the server draws. */
let live;

/** The spec the page shows. */
function spec() {
  const s = { race: state.race, sex: state.sex };
  if (Object.keys(state.choices).length) s.choices = state.choices;
  if (state.set) s.set = state.set;
  if (Object.keys(state.gear).length) s.gear = state.gear;
  s.pose = state.pose;
  if (state.backdrop && state.backdrop !== 'none') s.backdrop = state.backdrop.startsWith('screen:') ? { screen: state.backdrop.slice(7) } : state.backdrop;
  if (state.yaw || state.zoom !== 1 || state.panX || state.panY) {
    s.camera = { yaw: state.yaw, zoom: state.zoom };
    if (state.panX || state.panY) Object.assign(s.camera, { panX: state.panX, panY: state.panY });
  }
  return s;
}

const raceName = (id) => meta.races.find((r) => r.id === id)?.name ?? String(id);
const raceInfo = () => meta.races.find((r) => r.id === state.race) ?? meta.races[0];
const classesOf = (race) => race.classes.filter((c) => c !== 'Adventurer');

// ---- drawing ----

let ticket = 0;
let timer;
function redraw(soon = 250) {
  keep();
  clearTimeout(timer);
  timer = setTimeout(draw, soon);
}

/** The view in the live viewer's terms. */
const view = () => ({ yaw: state.yaw, zoom: state.zoom, panX: state.panX ?? 0, panY: state.panY ?? 0, face: state.face });
/** The zoom slider runs from far to close: it shows the closeness, the zoom's inverse, on a log scale. */
const zoomToSlider = (zoom) => -Math.log(zoom);

/** The spec without its camera: turning and zooming happen in the live view. */
function liveSpec() {
  const s = spec();
  delete s.camera;
  return s;
}

async function draw() {
  const mine = ++ticket;
  const picture = $('picture');
  picture.classList.add('busy');
  try {
    const result = live ? await post('/api/live', { spec: liveSpec() }) : await post('/api/render', { spec: spec() });
    if (mine !== ticket) return;
    if (live) {
      await live.show(result.url, view());
      if (mine !== ticket) return;
      picture.classList.add('live');
    } else $('preview').src = result.url;
    picture.classList.remove('blank');
    report = result.report;
    showProblems(report.problems ?? [], report.notes ?? []);
    renderSlots();
    renderPoses();
  } catch (error) {
    if (mine !== ticket) return;
    showProblems([], [], error.message);
  } finally {
    if (mine === ticket) picture.classList.remove('busy');
  }
}

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'look';

function showProblems(problems, notes, error) {
  const list = $('problems');
  list.replaceChildren(
    ...(error ? [el('li', { className: 'error', textContent: error })] : []),
    ...problems.filter((p) => !/needs a texture for slot 9/.test(p)).map((p) => el('li', { textContent: p })),
  );
}

// ---- character ----

function renderCharacter() {
  const races = $('race');
  const counts = {};
  for (const r of meta.races) counts[r.name] = (counts[r.name] ?? 0) + 1;
  races.replaceChildren(
    ...[...meta.races]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
      .map((r) => el('option', { value: r.id, textContent: counts[r.name] > 1 ? `${r.name} (${r.id})` : r.name })),
  );
  races.value = state.race;
  for (const b of $('sex').children) b.classList.toggle('on', b.dataset.sex === state.sex);
  const race = raceInfo();
  for (const b of $('sex').children) b.disabled = !race.sexes.includes(b.dataset.sex);
  const classes = classesOf(race);
  if (!classes.includes(state.cls)) state.cls = classes[0];
  $('class').replaceChildren(...classes.map((c) => el('option', { value: c, textContent: c })));
  $('class').value = state.cls;
}

async function loadOptions() {
  try {
    options = await get(`/api/options?race=${state.race}&sex=${state.sex}`);
  } catch {
    options = [];
  }
  renderOptions();
}

function renderOptions() {
  $('options').replaceChildren(
    ...options.map((option) => {
      const select = el('select', {}, el('option', { value: '', textContent: '–' }), option.choices.map((c, i) => el('option', { value: i + 1, textContent: /^\d+$/.test(c) ? c : `${i + 1}. ${c}` })));
      const chosen = state.choices[option.name];
      select.value = typeof chosen === 'number' ? chosen : typeof chosen === 'string' ? option.choices.findIndex((c) => c.toLowerCase() === chosen.toLowerCase()) + 1 || '' : '';
      select.onchange = () => {
        if (select.value) state.choices[option.name] = Number(select.value);
        else delete state.choices[option.name];
        redraw();
      };
      return el('label', {}, option.name, select);
    }),
  );
}

// ---- sets ----

let setTicket = 0;
async function searchSets() {
  const mine = ++setTicket;
  const params = new URLSearchParams({ q: state.q, limit: '60' });
  if (state.kind) params.set('kind', state.kind);
  if (state.expansion) params.set('expansion', state.expansion);
  if (state.myClass && state.cls) params.set('class', state.cls);
  try {
    const { sets, total } = await get(`/api/sets?${params}`);
    if (mine !== setTicket) return;
    $('set-count').textContent = total > sets.length ? `${sets.length} of ${total} sets` : `${total} set${total === 1 ? '' : 's'}`;
    $('set-list').replaceChildren(...sets.map(setItem));
  } catch (error) {
    $('set-count').textContent = error.message;
  }
}

const badge = (label) => (label ? el('span', { className: `badge ${slug(label)}`, textContent: label }) : null);

function setItem(set) {
  const on = state.set?.id !== undefined && set.variants.some((v) => v.id === state.set.id);
  const li = el(
    'li',
    { className: on ? 'on' : '' },
    el('div', { className: 'set-name' }, set.name, set.variants.length > 1 ? null : badge(set.label)),
    el('div', { className: 'set-meta', textContent: [set.expansion, set.kind, set.classes.length ? set.classes.join(', ') : 'any class'].join(' · ') }),
    el('div', { className: 'icons' }, set.pieces.map((p) => el('img', { src: `/icon/${p.icon}.png`, title: p.name, loading: 'lazy' }))),
  );
  if (set.variants.length > 1) {
    li.append(
      el(
        'div',
        { className: 'variants' },
        set.variants.map((v) =>
          el('button', {
            textContent: v.label,
            className: v.id === state.set?.id ? 'on' : '',
            onclick: (event) => {
              event.stopPropagation();
              wearSet({ ...set, id: v.id });
            },
          }),
        ),
      ),
    );
  }
  li.onclick = () => wearSet(set);
  return li;
}

function wearSet(set) {
  activeSet = set;
  state.set = { id: set.id };
  // The set's slots come from the set now; weapons and other slots keep what was picked.
  for (const piece of set.pieces) delete state.gear[piece.slot];
  if (!$('name').value || $('name').dataset.auto) {
    $('name').value = set.name;
    $('name').dataset.auto = '1';
  }
  redraw(0);
  searchSets();
}

// ---- the paper doll: the slots around the character, laid out as the game's character pane ----

const PAPERDOLL = {
  left: ['head', 'neck', 'shoulder', 'back', 'chest', 'shirt', 'tabard', 'wrist'],
  right: ['hands', 'waist', 'legs', 'feet', 'finger1', 'finger2', 'trinket1', 'trinket2'],
  weapons: ['mainHand', 'offHand'],
};
/** The game's empty-slot pictures (Interface/PaperDoll/UI-PaperDoll-Slot-*.blp); the back shows the chest's, as in the game. */
const EMPTY = {
  head: 136516, neck: 136519, shoulder: 136526, back: 136512, chest: 136512, shirt: 136525, tabard: 136527, wrist: 136530,
  hands: 136515, waist: 136529, legs: 136517, feet: 136513, finger1: 136514, finger2: 136514, trinket1: 136528, trinket2: 136528,
  mainHand: 136518, offHand: 136524,
};
/** Slots the game has that nothing on the model shows: kept, dimmed, so the pane looks as it does in the game. */
const UNSEEN = { neck: 'Neck', finger1: 'Finger', finger2: 'Finger', trinket1: 'Trinket', trinket2: 'Trinket' };

let openSlot;
function renderSlots() {
  const shown = report?.slots ?? {};
  const button = (id) => {
    const slot = meta.slots.find((s) => s.id === id);
    if (!slot) {
      return el('div', { className: 'pd-slot unseen', title: `${UNSEEN[id]}: not shown on the character` }, el('img', { src: `/icon/${EMPTY[id]}.png`, alt: '' }));
    }
    const item = shown[id];
    const changed = id in state.gear;
    const node = el(
      'button',
      {
        className: `pd-slot${item ? ` q${item.quality}` : ' vacant'}${openSlot === id ? ' open' : ''}${changed ? ' changed' : ''}`,
        onclick: (event) => {
          event.stopPropagation();
          toggleSlot(id);
        },
        onmouseenter: () => tooltip(node, slot, item, changed),
        onmouseleave: () => tooltip(),
        ariaLabel: `${slot.name}: ${item ? item.name : 'empty'}`,
      },
      el('img', { src: `/icon/${item ? item.icon : EMPTY[id]}.png`, alt: '' }),
    );
    return node;
  };
  $('pd-left').replaceChildren(...PAPERDOLL.left.map(button));
  $('pd-right').replaceChildren(...PAPERDOLL.right.map(button));
  $('pd-weapons').replaceChildren(...PAPERDOLL.weapons.map(button));
  const pop = $('slot-pop');
  const slot = meta.slots.find((s) => s.id === openSlot);
  pop.hidden = !slot;
  if (slot) pop.replaceChildren(picker(slot, shown[slot.id]));
}

/** A tooltip like the game's beside a slot, or none. */
function tooltip(node, slot, item, changed) {
  const tip = $('tooltip');
  if (!node || openSlot) {
    tip.hidden = true;
    return;
  }
  tip.replaceChildren(
    ...[
      el('div', { className: `tip-name q${item?.quality ?? 1}`, textContent: item ? item.name : slot.name }),
      el('div', { className: 'tip-slot', textContent: item ? slot.name : 'Empty' }),
      changed && el('div', { className: 'tip-note', textContent: state.gear[slot.id] === null ? 'Hidden on this look' : 'Changed from the set' }),
      el('div', { className: 'tip-hint', textContent: 'Click to change' }),
    ].filter(Boolean),
  );
  tip.hidden = false;
  const board = $('picture').getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const left = box.left - board.left;
  const onRight = left > board.width / 2;
  tip.style.top = `${Math.min(box.top - board.top, board.height - tip.offsetHeight - 8)}px`;
  tip.style.left = onRight ? '' : `${left + box.width + 8}px`;
  tip.style.right = onRight ? `${board.right - box.left + 8}px` : '';
}

function toggleSlot(id) {
  openSlot = openSlot === id ? undefined : id;
  tooltip();
  renderSlots();
  if (openSlot) $('slot-pop').querySelector('input')?.focus({ preventScroll: true });
}

function closeSlot() {
  if (!openSlot) return;
  openSlot = undefined;
  renderSlots();
}

function picker(slot, item) {
  const results = el('div', { className: 'pop-results' });
  const input = el('input', { type: 'search', placeholder: `Search ${slot.name.toLowerCase()} items`, autocomplete: 'off' });
  let mine = 0;
  const search = async () => {
    const asked = ++mine;
    const { items, total } = await get(`/api/items?slot=${slot.id}&q=${encodeURIComponent(input.value)}&limit=40`);
    if (asked !== mine) return;
    results.replaceChildren(
      el('div', { className: 'dim small', textContent: `${total} items` }),
      ...items.map((found) =>
        el('div', {
          className: `item q${found.quality}`,
          onclick: () => {
            state.gear[slot.id] = found.id;
            closeSlot();
            redraw(0);
          },
        }, el('img', { src: `/icon/${found.icon}.png`, loading: 'lazy' }), found.name),
      ),
    );
  };
  let wait;
  input.oninput = () => {
    clearTimeout(wait);
    wait = setTimeout(search, 200);
  };
  search();
  return el(
    'div',
    { className: 'picker', onclick: (event) => event.stopPropagation() },
    el(
      'div',
      { className: 'pop-head' },
      el('div', {}, el('div', { className: 'slot-name', textContent: slot.name }), el('div', { className: `item-name q${item?.quality ?? 1}`, textContent: item ? item.name : 'Empty' })),
      el('button', { className: 'ghost', textContent: '✕', ariaLabel: 'Close', onclick: closeSlot }),
    ),
    el(
      'div',
      { className: 'row' },
      el('button', { textContent: 'Hide slot', onclick: () => { state.gear[slot.id] = null; closeSlot(); redraw(0); } }),
      el('button', { textContent: 'Undo change', disabled: !(slot.id in state.gear), onclick: () => { delete state.gear[slot.id]; closeSlot(); redraw(0); } }),
    ),
    input,
    results,
  );
}

// ---- stage controls ----

function renderPoses() {
  const poses = report?.poses ?? meta.poses;
  $('poses').replaceChildren(
    ...poses.map((name) =>
      el('button', {
        textContent: name,
        className: name === state.pose ? 'on' : '',
        onclick: () => {
          state.pose = name;
          renderPoses();
          redraw(0);
        },
      }),
    ),
  );
}

function renderBackdrops() {
  $('backdrop').replaceChildren(
    el('option', { value: 'none', textContent: 'No backdrop' }),
    el('optgroup', { label: 'Gradients' }, meta.gradients.map((g) => el('option', { value: g, textContent: g }))),
    el('optgroup', { label: 'Loading screens' }, meta.screens.map((s) => el('option', { value: `screen:${s}`, textContent: s }))),
  );
  $('backdrop').value = state.backdrop;
}

function syncControls() {
  renderCharacter();
  renderBackdrops();
  renderPoses();
  $('zoom').value = zoomToSlider(state.zoom);
  $('face').classList.toggle('on', state.face !== undefined);
  $('set-q').value = state.q;
  $('expansion').value = state.expansion;
  $('my-class').checked = state.myClass;
  for (const b of $('kinds').children) b.classList.toggle('on', b.dataset.kind === state.kind);
}

// ---- composer ----

function say(kind, text) {
  const node = el('div', { className: `msg ${kind}`, textContent: text });
  $('chat').append(node);
  node.scrollIntoView({ block: 'nearest' });
  return node;
}

async function compose(prompt) {
  say('you', prompt);
  const bubble = say('it', 'Looking through the sets…');
  const steps = el('ul', { className: 'steps' });
  bubble.append(steps);
  $('send').disabled = true;
  try {
    const { id } = await post('/api/compose', { prompt, current: $('with-current').checked ? spec() : undefined, session: composerSession });
    let job;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      job = await get(`/api/compose/status?id=${id}`);
      steps.replaceChildren(...job.steps.map((s) => el('li', { textContent: s })));
      if (job.state !== 'working') break;
    }
    if (job.state === 'failed') throw new Error(job.error);
    composerSession = job.session;
    bubble.firstChild.textContent = job.message || `${job.looks.length} looks`;
    await showLooks(job.looks);
  } catch (error) {
    bubble.classList.add('failed');
    bubble.firstChild.textContent = error.message;
  } finally {
    $('send').disabled = false;
  }
}

async function showLooks(looks) {
  const cards = looks.map((look) => {
    const card = el('div', { className: 'look', onclick: () => wearLook(look) }, el('div', { className: 'pending', textContent: look.error ? 'Could not place' : 'Waiting…' }), el('div', { className: 'title', textContent: look.title }));
    if (look.error) card.append(el('div', { className: 'error', textContent: look.error }));
    return card;
  });
  $('grid').prepend(...cards);
  // One at a time: the server draws them in turn anyway.
  for (const [i, look] of looks.entries()) {
    if (look.error) continue;
    const card = cards[i];
    card.firstChild.textContent = 'Drawing…';
    try {
      const { url } = await post('/api/render', { spec: { ...look.spec, size: { width: 720, height: 720 } } });
      card.firstChild.replaceWith(el('img', { src: url, alt: look.title }));
    } catch (error) {
      card.firstChild.textContent = 'Could not draw';
      card.append(el('div', { className: 'error', textContent: error.message }));
    }
  }
}

function wearLook(look, { keepView = false } = {}) {
  const s = look.spec;
  if (look.cls) state.cls = look.cls;
  const byName = meta.races.find((r) => r.name.toLowerCase() === String(s.race).toLowerCase());
  state.race = typeof s.race === 'number' ? s.race : (byName?.id ?? state.race);
  state.sex = s.sex === 1 || s.sex === 'female' ? 'female' : 'male';
  state.choices = s.choices ?? {};
  state.set = s.set ?? null;
  state.gear = s.gear ?? {};
  state.pose = typeof s.pose === 'string' ? s.pose : 'Stand';
  state.backdrop = typeof s.backdrop === 'string' ? s.backdrop : s.backdrop?.screen ? `screen:${s.backdrop.screen}` : 'none';
  if (!keepView) {
    state.yaw = s.camera?.yaw ?? 0;
    state.zoom = s.camera?.zoom ?? 1;
    state.panX = s.camera?.panX ?? 0;
    state.panY = s.camera?.panY ?? 0;
    state.face = undefined;
  }
  $('name').value = look.title;
  delete $('name').dataset.auto;
  syncControls();
  loadOptions();
  searchSets();
  redraw(0);
  showTab('character');
}

// ---- random looks ----

const randomRequest = (mode, count) => ({ mode, count, race: state.race, sex: state.sex, cls: state.cls, pose: state.pose, backdrop: spec().backdrop });

async function random(mode) {
  try {
    const { looks } = await post('/api/random', randomRequest(mode, 1));
    // The view stays where it is, so a face close-up can be rerolled.
    if (looks[0]) wearLook(looks[0], { keepView: true });
  } catch (error) {
    showProblems([], [], error.message);
  }
}

async function roll() {
  $('roll').disabled = true;
  try {
    const [sets, mixes] = await Promise.all([post('/api/random', randomRequest('set', 3)), post('/api/random', randomRequest('mix', 3))]);
    say('it', `Rolled 6 looks for a ${raceName(state.race)} ${state.cls}: three sets and three mixes.`);
    if (window.matchMedia('(max-width: 820px)').matches) showTab('right');
    await showLooks([...sets.looks, ...mixes.looks]);
  } catch (error) {
    showProblems([], [], error.message);
  } finally {
    $('roll').disabled = false;
  }
}

// ---- wiring ----

function showTab(tab) {
  $('layout').dataset.tab = tab;
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === tab);
}

function wire() {
  $('race').onchange = () => {
    state.race = Number($('race').value);
    state.choices = {};
    renderCharacter();
    loadOptions();
    searchSets();
    redraw(0);
  };
  for (const b of $('sex').children) {
    b.onclick = () => {
      state.sex = b.dataset.sex;
      state.choices = {};
      renderCharacter();
      loadOptions();
      redraw(0);
    };
  }
  $('class').onchange = () => {
    state.cls = $('class').value;
    searchSets();
    keep();
  };
  $('scarletfire').onclick = () => {
    const race = meta.races.find((r) => r.name === SCARLETFIRE.race);
    Object.assign(state, { race: race.id, sex: SCARLETFIRE.sex, cls: SCARLETFIRE.cls, choices: { ...SCARLETFIRE.choices } });
    $('name').value = 'Scarletfire';
    delete $('name').dataset.auto;
    syncControls();
    loadOptions();
    searchSets();
    redraw(0);
  };
  $('clear-look').onclick = () => {
    state.choices = {};
    renderOptions();
    redraw(0);
  };

  let wait;
  $('set-q').oninput = () => {
    state.q = $('set-q').value;
    clearTimeout(wait);
    wait = setTimeout(searchSets, 200);
    keep();
  };
  $('kinds').replaceChildren(
    ...KINDS.map(([kind, label]) =>
      el('button', {
        textContent: label,
        onclick: () => {
          state.kind = kind;
          syncControls();
          searchSets();
          keep();
        },
      }),
    ),
  );
  for (const b of $('kinds').children) b.dataset.kind = KINDS[[...$('kinds').children].indexOf(b)][0];
  $('expansion').append(...meta.expansions.map((e, i) => el('option', { value: i, textContent: e })));
  $('expansion').onchange = () => {
    state.expansion = $('expansion').value;
    searchSets();
    keep();
  };
  $('my-class').onchange = () => {
    state.myClass = $('my-class').checked;
    searchSets();
    keep();
  };

  $('backdrop').onchange = () => {
    state.backdrop = $('backdrop').value;
    redraw(0);
  };
  $('zoom').oninput = () => {
    state.zoom = Number(Math.exp(-Number($('zoom').value)).toFixed(3));
    // The slider sets the zoom by hand, which lets go of the face.
    state.face = undefined;
    $('face').classList.remove('on');
    if (live) {
      live.setView(view());
      keep();
    } else redraw(400);
  };
  $('full-body').onclick = () => {
    if (live) live.fullBody();
    else {
      Object.assign(state, { zoom: 1, panX: 0, panY: 0, face: undefined });
      redraw(0);
    }
  };
  $('face').onclick = () => {
    if (live) live.face();
  };
  $('face').disabled = !live;
  $('random-set').onclick = () => random('set');
  $('random-mix').onclick = () => random('mix');
  $('random-anyone').onclick = () => random('anyone');
  $('roll').onclick = roll;
  $('download').onclick = async () => {
    $('download').disabled = true;
    try {
      // The picture at the angle on screen.
      const { url } = await post('/api/render', { spec: spec() });
      const a = el('a', { href: url, download: `${slug($('name').value || 'look')}.png` });
      document.body.append(a);
      a.click();
      a.remove();
    } catch (error) {
      showProblems([], [], error.message);
    } finally {
      $('download').disabled = false;
    }
  };
  $('name').oninput = () => delete $('name').dataset.auto;

  $('save').onclick = async () => {
    $('save').disabled = true;
    $('saved').textContent = 'Saving a full-size picture…';
    try {
      const { url } = await post('/api/save', { spec: spec(), name: $('name').value });
      $('saved').replaceChildren('Saved: ', el('a', { href: url, target: '_blank', textContent: url }));
    } catch (error) {
      $('saved').textContent = error.message;
    } finally {
      $('save').disabled = false;
    }
  };
  $('copy').onclick = () => {
    const text = JSON.stringify({ ...spec(), out: `${slug($('name').value || 'look')}.png` }, null, 2);
    const done = () => ($('copy').textContent = 'Copied');
    // The clipboard API needs https or localhost; the tailnet address is neither.
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done);
    else {
      const area = el('textarea', { value: text });
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      done();
    }
    setTimeout(() => ($('copy').textContent = 'Copy spec'), 1500);
  };

  $('compose').onsubmit = (event) => {
    event.preventDefault();
    const prompt = $('prompt').value.trim();
    if (!prompt) return;
    $('prompt').value = '';
    compose(prompt);
  };
  $('prompt').onkeydown = (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) $('compose').requestSubmit();
  };
  $('ideas').replaceChildren(...IDEAS.map((idea) => el('button', { type: 'button', textContent: idea, onclick: () => ($('prompt').value = idea) })));
  for (const b of $('tabs').children) b.onclick = () => showTab(b.dataset.tab);
  document.addEventListener('keydown', (event) => event.key === 'Escape' && closeSlot());
  $('slot-pop').onclick = (event) => event.stopPropagation();
  // Turning the character puts the picker away.
  $('live').addEventListener('pointerdown', closeSlot);
  $('preview').addEventListener('click', closeSlot);
}

async function start() {
  const status = $('status');
  for (;;) {
    try {
      const s = await get('/api/status');
      if (s.ready) break;
      status.textContent = s.error ? `Cannot read the game: ${s.error}. Is the MacBook awake?` : 'Opening the game on the MacBook…';
      status.classList.toggle('bad', Boolean(s.error));
    } catch {
      status.textContent = 'The server is not answering';
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  meta = await get('/api/meta');
  status.textContent = `Retail ${meta.build}`;
  status.className = 'status good';
  if (!meta.races.some((r) => r.id === state.race)) state.race = meta.races[0].id;
  // A touchscreen has no scroll wheel or double-click to mention.
  if (window.matchMedia('(pointer: coarse)').matches) $('hint').textContent = 'Drag to turn · two fingers to move and zoom · tap a slot to change it';
  if (webglWorks()) {
    live = new Live($('live'), (seen) => {
      Object.assign(state, { face: undefined }, seen);
      $('face').classList.toggle('on', seen.face !== undefined);
      $('zoom').value = zoomToSlider(state.zoom);
      keep();
    });
  }
  wire();
  syncControls();
  renderSlots();
  showTab('character');
  loadOptions();
  searchSets();
  $('picture').classList.add('blank');
  draw();
}

start();
