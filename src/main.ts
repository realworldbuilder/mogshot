import './app/style.css';
import { describeFile, formatBytes } from './app/describe';
import { InstallError, type OpenStage } from './casc/storage';
import { filesFromDroppedFolder } from './io/dropped-folder';
import { type PickedFile, pickedFiles } from './io/file-list-source';
import type { OpenResult, ProbeResult, TableSummary } from './worker/api';
import { DataClient, DataError } from './worker/client';

/** Files read to prove the local archives work: a database table, a model and a texture. */
const PROBES = [
  { fileId: 1305311, label: 'ChrRaces.db2' },
  { fileId: 1011653, label: 'Human male model' },
  { fileId: 3537040, label: 'A human male texture' },
];

const STAGE_TEXT: Record<OpenStage, string> = {
  config: 'Reading the build information…',
  index: 'Reading the archive index…',
  encoding: 'Reading the encoding table (about 160 MB)…',
  root: 'Reading the file list…',
  join: 'Matching file IDs to archives…',
};

// Mogshot is developed and tested in Chrome. Other browsers get the page with a warning.
const chromium = 'chrome' in window;

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <h1>Mogshot</h1>
  <p class="dim">Transparent PNG cutouts of World of Warcraft characters, made from your own game files in your browser.</p>

  <section class="panel">
    <h2>Early build: folder check only</h2>
    <p>There is nothing to export yet. This page checks that Mogshot can read your game files.
    They are read on your computer and are never uploaded. The only thing downloaded is the
    community's description of the game's database tables, from GitHub.</p>
    ${chromium ? '' : '<p class="bad">Mogshot is only tested in Chrome. It may not work in this browser.</p>'}
    <div id="drop">
      <p><strong>Drag your World of Warcraft folder onto this page</strong></p>
      <p class="dim small">It is in <code>Applications</code> on a Mac and usually in
      <code>C:\\Program Files (x86)</code> on Windows.</p>
      <label class="primary" id="choose">or choose the folder…<input type="file" id="folder" webkitdirectory hidden /></label>
    </div>
    <p class="dim small">If you use the button, Chrome asks whether to "upload" the files. That is Chrome's
    wording for letting a page read a folder. Nothing leaves your computer. Not tested on Windows yet.</p>
  </section>

  <section class="panel" id="result" hidden></section>

  <footer class="dim small">
    <p>Mogshot is a fan project. It is not affiliated with or endorsed by Blizzard Entertainment.
    World of Warcraft is a trademark of Blizzard Entertainment, Inc.</p>
    <p><a href="https://github.com/realworldbuilder/mogshot">Source on GitHub</a></p>
  </footer>
`;

const result = document.querySelector<HTMLElement>('#result')!;
const drop = document.querySelector<HTMLElement>('#drop')!;
const folder = document.querySelector<HTMLInputElement>('#folder')!;

// Started on page load so the worker script is already in memory when the folder arrives.
const data = new DataClient();
let busy = false;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function showStatus(text: string, bad = false): void {
  result.hidden = false;
  result.innerHTML = `<p class="${bad ? 'bad' : 'dim'}" id="status">${escapeHtml(text)}</p>`;
}

function probeRow(label: string, fileId: number, probe: ProbeResult): string {
  let text: string;
  if (probe.status === 'ok') {
    const notes = [
      probe.encryptedChunks > 0 ? `${probe.encryptedChunks} encrypted sections skipped` : '',
      probe.highRes ? 'high-res' : '',
    ].filter(Boolean);
    text = `<span class="ok">Read</span> ${formatBytes(probe.size)}, ${describeFile(probe.head)}${
      notes.length ? `, ${notes.join(', ')}` : ''
    } <span class="dim">(${probe.ms.toFixed(0)} ms)</span>`;
  } else if (probe.status === 'missing') {
    text = `<span class="bad">Not installed</span>: this build lists the file but it is not on disk`;
  } else {
    text = `<span class="dim">Not part of this build</span>`;
  }
  return `<dt>${escapeHtml(label)} <span class="small">#${fileId}</span></dt><dd>${text}</dd>`;
}

/** The game database check: races and items, decoded with definitions downloaded from GitHub. */
type TablesCheck = { races: TableSummary; items: TableSummary } | { error: string };

function tablesRow(check: TablesCheck): string {
  if ('error' in check) {
    return `<span class="bad">Not read</span>: the table definitions could not be downloaded from GitHub
      (${escapeHtml(check.error)}). They are the one thing Mogshot fetches; check your connection and try again.`;
  }
  const { races, items } = check;
  const hidden = items.encryptedRows > 0 ? `; ${items.encryptedRows.toLocaleString()} more are encrypted by Blizzard and unavailable` : '';
  return `<span class="ok">Read</span> ${races.rows} races and ${items.rows.toLocaleString()} items${hidden}
    <span class="dim">(${(races.ms + items.ms).toFixed(0)} ms)</span>`;
}

function showResult(opened: OpenResult, probes: ProbeResult[], tables: TablesCheck, files: PickedFile[]): void {
  const { info, stats, products } = opened;
  const percent = ((stats.onDisk / stats.listed) * 100).toFixed(2);
  const highRes =
    stats.highResListed === 0
      ? 'This build has no separate high-res textures'
      : stats.highResOnDisk / stats.highResListed > 0.9
        ? `Installed (${stats.highResOnDisk.toLocaleString()} of ${stats.highResListed.toLocaleString()})`
        : `Not installed (${stats.highResOnDisk.toLocaleString()} of ${stats.highResListed.toLocaleString()} on disk). Standard textures will be used.`;
  const productRow =
    products.length > 1
      ? `<select id="product">${products
          .map(
            (p) =>
              `<option value="${escapeHtml(p.product)}"${p.product === info.product ? ' selected' : ''}>${escapeHtml(p.product)} ${escapeHtml(p.version)}</option>`,
          )
          .join('')}</select>`
      : `<code>${escapeHtml(info.product)}</code>`;

  result.hidden = false;
  result.innerHTML = `
    <h2 id="status">Your game files can be read</h2>
    <dl>
      <dt>Product</dt><dd>${productRow}</dd>
      <dt>Build</dt><dd id="build">${escapeHtml(info.version)} <span class="dim">(${escapeHtml(info.buildName)}, ${escapeHtml(info.locale)})</span></dd>
      <dt>Files on disk</dt><dd id="files">${stats.onDisk.toLocaleString()} of ${stats.listed.toLocaleString()} (${percent}%)</dd>
      <dt>High-res textures</dt><dd id="highres">${highRes}</dd>
      <dt>Indexed in</dt><dd id="indexed">${(opened.ms / 1000).toFixed(1)} s</dd>
      ${PROBES.map((probe, i) => probeRow(probe.label, probe.fileId, probes[i]!)).join('')}
      <dt>Game database</dt><dd id="tables">${tablesRow(tables)}</dd>
    </dl>
  `;
  result.querySelector<HTMLSelectElement>('#product')?.addEventListener('change', (event) => {
    void openFolder(files, (event.target as HTMLSelectElement).value);
  });
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const install = error instanceof InstallError || (error instanceof DataError && error.install);
  showStatus(install ? message : `Something went wrong reading the folder: ${message}`, true);
}

async function openFolder(files: PickedFile[], product?: string): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    showStatus(STAGE_TEXT.config);
    const opened = await data.open(files, product, (stage) => showStatus(STAGE_TEXT[stage]));
    const probes: ProbeResult[] = [];
    for (const probe of PROBES) probes.push(await data.probe(probe.fileId));
    showStatus('Reading the game database…');
    let tables: TablesCheck;
    try {
      tables = { races: await data.tableSummary('ChrRaces'), items: await data.tableSummary('ItemSparse') };
    } catch (error) {
      tables = { error: error instanceof Error ? error.message : String(error) };
    }
    showResult(opened, probes, tables, files);
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
  }
}

folder.addEventListener('change', () => {
  if (!folder.files || folder.files.length === 0) return;
  void openFolder(pickedFiles(folder.files));
});

// The whole page is the drop target, so a near miss does not make Chrome open the folder instead.
window.addEventListener('dragover', (event) => {
  event.preventDefault();
  drop.classList.add('over');
});
window.addEventListener('dragleave', () => drop.classList.remove('over'));
window.addEventListener('drop', async (event) => {
  event.preventDefault();
  drop.classList.remove('over');
  // The entry must be taken during the event; it is gone afterwards.
  const entry = event.dataTransfer?.items[0]?.webkitGetAsEntry();
  if (!entry?.isDirectory) {
    showStatus('Drop the World of Warcraft folder itself, not a file inside it.', true);
    return;
  }
  try {
    showStatus(STAGE_TEXT.config);
    await openFolder(await filesFromDroppedFolder(entry as FileSystemDirectoryEntry));
  } catch (error) {
    showError(error);
  }
});
