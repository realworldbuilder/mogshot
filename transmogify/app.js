// Transmogify's page. State is a Mogshot spec in pieces; every change draws it again on the server.

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

const DEFAULT = { race: 4, sex: 'female', cls: 'Druid', choices: {}, set: null, gear: {}, pose: 'Stand', backdrop: 'Ember', yaw: 0, zoom: 1, kind: '', expansion: '', myClass: true, q: '' };
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

/** The spec the page shows. */
function spec() {
  const s = { race: state.race, sex: state.sex };
  if (Object.keys(state.choices).length) s.choices = state.choices;
  if (state.set) s.set = state.set;
  if (Object.keys(state.gear).length) s.gear = state.gear;
  s.pose = state.pose;
  if (state.backdrop && state.backdrop !== 'none') s.backdrop = state.backdrop.startsWith('screen:') ? { screen: state.backdrop.slice(7) } : state.backdrop;
  if (state.yaw || state.zoom !== 1) s.camera = { yaw: state.yaw, zoom: state.zoom };
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

async function draw() {
  const mine = ++ticket;
  const picture = $('picture');
  picture.classList.add('busy');
  try {
    const result = await post('/api/render', { spec: spec() });
    if (mine !== ticket) return;
    $('preview').src = result.url;
    $('download').href = result.url;
    $('download').download = `${slug($('name').value || 'look')}.png`;
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

// ---- slots ----

let openSlot;
function renderSlots() {
  const shown = report?.slots ?? {};
  $('slots').replaceChildren(
    ...meta.slots.map((slot) => {
      const item = shown[slot.id];
      const changed = slot.id in state.gear;
      const row = el(
        'li',
        {},
        el(
          'div',
          { className: 'slot', onclick: () => toggleSlot(slot.id) },
          item ? el('img', { src: `/icon/${item.icon}.png`, alt: '' }) : el('span', { className: 'blank' }),
          el(
            'div',
            { className: 'what' },
            el('div', { className: 'slot-name' }, slot.name, changed ? el('span', { className: 'changed', textContent: state.gear[slot.id] === null ? ' · hidden' : ' · changed' }) : null),
            el('div', { className: `item-name q${item?.quality ?? 1}`, textContent: item ? item.name : '—' }),
          ),
        ),
      );
      if (openSlot === slot.id) row.append(picker(slot));
      return row;
    }),
  );
}

function toggleSlot(id) {
  openSlot = openSlot === id ? undefined : id;
  renderSlots();
  if (openSlot) document.querySelector('.picker input')?.focus();
}

function picker(slot) {
  const results = el('div');
  const input = el('input', { type: 'search', placeholder: `Search ${slot.name.toLowerCase()} items`, autocomplete: 'off' });
  let mine = 0;
  const search = async () => {
    const asked = ++mine;
    const { items, total } = await get(`/api/items?slot=${slot.id}&q=${encodeURIComponent(input.value)}&limit=30`);
    if (asked !== mine) return;
    results.replaceChildren(
      el('div', { className: 'dim small', textContent: `${total} items` }),
      ...items.map((item) =>
        el('div', {
          className: `item q${item.quality}`,
          onclick: () => {
            state.gear[slot.id] = item.id;
            openSlot = undefined;
            redraw(0);
          },
        }, el('img', { src: `/icon/${item.icon}.png`, loading: 'lazy' }), item.name),
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
    { className: 'picker' },
    el(
      'div',
      { className: 'row' },
      el('button', { textContent: 'Hide slot', onclick: () => { state.gear[slot.id] = null; openSlot = undefined; redraw(0); } }),
      el('button', { textContent: 'Undo change', disabled: !(slot.id in state.gear), onclick: () => { delete state.gear[slot.id]; openSlot = undefined; redraw(0); } }),
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
  $('yaw').value = state.yaw;
  $('zoom').value = state.zoom;
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

function wearLook(look) {
  const s = look.spec;
  const byName = meta.races.find((r) => r.name.toLowerCase() === String(s.race).toLowerCase());
  state.race = typeof s.race === 'number' ? s.race : (byName?.id ?? state.race);
  state.sex = s.sex === 1 || s.sex === 'female' ? 'female' : 'male';
  state.choices = s.choices ?? {};
  state.set = s.set ?? null;
  state.gear = s.gear ?? {};
  state.pose = typeof s.pose === 'string' ? s.pose : 'Stand';
  state.backdrop = typeof s.backdrop === 'string' ? s.backdrop : s.backdrop?.screen ? `screen:${s.backdrop.screen}` : 'none';
  state.yaw = s.camera?.yaw ?? 0;
  state.zoom = s.camera?.zoom ?? 1;
  $('name').value = look.title;
  delete $('name').dataset.auto;
  syncControls();
  loadOptions();
  searchSets();
  redraw(0);
  showTab('character');
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
  $('yaw').oninput = () => {
    state.yaw = Number($('yaw').value);
    redraw(400);
  };
  $('zoom').oninput = () => {
    state.zoom = Number($('zoom').value);
    redraw(400);
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
  wire();
  syncControls();
  showTab('character');
  loadOptions();
  searchSets();
  $('picture').classList.add('blank');
  draw();
}

start();
