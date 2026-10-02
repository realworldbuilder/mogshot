import './app/style.css';
import { describeFile, formatBytes } from './app/describe';
import type { OpenStage } from './casc/storage';
import { pickedFiles } from './io/file-list-source';
import type { FolderSource, OpenResult, ProbeResult } from './worker/api';
import { DataClient, DataError } from './worker/client';

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

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

const supported = typeof window.showDirectoryPicker === 'function';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <h1>Mogshot</h1>
  <p class="dim">Transparent PNG cutouts of World of Warcraft characters, made from your own game files in your browser.</p>

  <section class="panel">
    <h2>Early build: folder check only</h2>
    <p>There is nothing to export yet. This page checks that Mogshot can read your game files.
    They are read on your computer and are never uploaded.</p>
    ${
      supported
        ? `
    <button class="primary" id="pick">Choose your World of Warcraft folder</button>
    <p class="dim small" style="margin-top:12px">Usually <code>/Applications/World of Warcraft</code> on a Mac
    or <code>C:\\Program Files (x86)\\World of Warcraft</code> on Windows.</p>
    <details>
      <summary>Chrome says it can't open that folder?</summary>
      <div>
        <p class="small">Chrome blocks its folder picker for anything inside <code>Program Files</code>.
        Use this picker instead. Chrome will ask whether to "upload" the files; nothing is uploaded.
        This path has not been tested on Windows yet.</p>
        <input type="file" id="fallback" webkitdirectory />
      </div>
    </details>`
        : `<p class="bad">Mogshot needs Chrome or Edge on a Mac or Windows computer. This browser can't open a folder for a web page.</p>`
    }
  </section>

  <section class="panel" id="result" hidden></section>

  <footer class="dim small">
    <p>Mogshot is a fan project. It is not affiliated with or endorsed by Blizzard Entertainment.
    World of Warcraft is a trademark of Blizzard Entertainment, Inc.</p>
    <p><a href="https://github.com/realworldbuilder/mogshot">Source on GitHub</a></p>
  </footer>
`;

const result = document.querySelector<HTMLElement>('#result')!;
const pick = document.querySelector<HTMLButtonElement>('#pick');
const fallback = document.querySelector<HTMLInputElement>('#fallback');

// Started on page load so the worker script is already in memory when the folder is picked.
const data = supported ? new DataClient() : undefined;

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

function showResult(opened: OpenResult, probes: ProbeResult[], source: FolderSource): void {
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
    </dl>
  `;
  result.querySelector<HTMLSelectElement>('#product')?.addEventListener('change', (event) => {
    void openFolder(source, (event.target as HTMLSelectElement).value);
  });
}

async function openFolder(source: FolderSource, product?: string): Promise<void> {
  if (!data) return;
  if (pick) pick.disabled = true;
  try {
    showStatus(STAGE_TEXT.config);
    const opened = await data.open(source, product, (stage) => showStatus(STAGE_TEXT[stage]));
    const probes: ProbeResult[] = [];
    for (const probe of PROBES) probes.push(await data.probe(probe.fileId));
    showResult(opened, probes, source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showStatus(error instanceof DataError && error.install ? message : `Something went wrong reading the folder: ${message}`, true);
  } finally {
    if (pick) pick.disabled = false;
  }
}

pick?.addEventListener('click', async () => {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker!({ id: 'wow', mode: 'read' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return; // picker cancelled
    throw error;
  }
  await openFolder({ kind: 'handle', handle });
});

fallback?.addEventListener('change', async () => {
  if (!fallback.files || fallback.files.length === 0) return;
  await openFolder({ kind: 'files', files: pickedFiles(fallback.files) });
});
