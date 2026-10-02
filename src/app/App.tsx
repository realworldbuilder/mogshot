import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { InstallError, type OpenStage } from '../casc/storage';
import { filesFromDroppedFolder } from '../io/dropped-folder';
import { type PickedFile, pickedFiles } from '../io/file-list-source';
import type { OpenResult } from '../worker/api';
import { DataClient, DataError } from '../worker/client';
import { FolderDetails } from './FolderDetails';
import { Viewer } from './Viewer';

const STAGE_TEXT: Record<OpenStage, string> = {
  config: 'Reading the build information…',
  index: 'Reading the archive index…',
  encoding: 'Reading the encoding table (about 160 MB)…',
  root: 'Reading the file list…',
  join: 'Matching file IDs to archives…',
};

type Phase =
  | { kind: 'empty' }
  | { kind: 'opening'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; opened: OpenResult; files: PickedFile[] };

// Mogshot is developed and tested in Chrome. Other browsers get the page with a warning.
const chromium = 'chrome' in window;

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function App() {
  // Started with the page so the worker script is already in memory when the folder arrives.
  const data = useRef<DataClient>(null);
  data.current ??= new DataClient();

  const [phase, setPhase] = useState<Phase>({ kind: 'empty' });
  const [dragging, setDragging] = useState(false);
  const busy = useRef(false);

  const fail = (error: unknown) => {
    const install = error instanceof InstallError || (error instanceof DataError && error.install);
    setPhase({ kind: 'error', message: install ? messageOf(error) : `Something went wrong reading the folder: ${messageOf(error)}` });
  };

  const openFolder = useCallback(async (files: PickedFile[], product?: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      setPhase({ kind: 'opening', message: STAGE_TEXT.config });
      const opened = await data.current!.open(files, product, (stage) => setPhase({ kind: 'opening', message: STAGE_TEXT[stage] }));
      setPhase({ kind: 'ready', opened, files });
    } catch (error) {
      fail(error);
    } finally {
      busy.current = false;
    }
  }, []);

  // The whole page is the drop target, so a near miss does not make Chrome open the folder instead.
  useEffect(() => {
    const over = (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    };
    const leave = () => setDragging(false);
    const drop = async (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      // The entry must be taken during the event; it is gone afterwards.
      const entry = event.dataTransfer?.items[0]?.webkitGetAsEntry();
      if (!entry?.isDirectory) {
        setPhase({ kind: 'error', message: 'Drop the World of Warcraft folder itself, not a file inside it.' });
        return;
      }
      try {
        setPhase({ kind: 'opening', message: STAGE_TEXT.config });
        await openFolder(await filesFromDroppedFolder(entry as FileSystemDirectoryEntry));
      } catch (error) {
        fail(error);
      }
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [openFolder]);

  const chooser = (label: string) => (
    <label class="primary" id="choose">
      {label}
      <input
        type="file"
        id="folder"
        // @ts-expect-error webkitdirectory is not in the DOM typings
        webkitdirectory
        hidden
        onChange={(event) => {
          const input = event.currentTarget;
          if (input.files && input.files.length > 0) void openFolder(pickedFiles(input.files));
          input.value = '';
        }}
      />
    </label>
  );

  return (
    <>
      <h1>Mogshot</h1>
      <p class="dim">
        Transparent PNG cutouts of World of Warcraft characters, made from your own game files in your browser.
      </p>

      {phase.kind !== 'ready' && (
        <section class="panel">
          <h2>Start with your World of Warcraft folder</h2>
          <p>
            Pick a race, set the look, put on gear, strike a pose, and download a transparent PNG up to 4K for
            thumbnails, Canva and overlays. Everything is drawn from the game files on your computer, in this tab.
            Nothing is uploaded; the only download is the community's description of the game's database
            tables, from GitHub.
          </p>
          {!chromium && <p class="bad">Mogshot is only tested in Chrome. It may not work in this browser.</p>}
          <div id="drop" class={dragging ? 'over' : ''}>
            <p>
              <strong>Drag your World of Warcraft folder onto this page</strong>
            </p>
            <p class="dim small">
              It is in <code>Applications</code> on a Mac and usually in <code>C:\Program Files (x86)</code> on
              Windows.
            </p>
            {chooser('or choose the folder…')}
          </div>
          <p class="dim small">
            If you use the button, Chrome asks whether to "upload" the files. That is Chrome's wording for letting a
            page read a folder; nothing leaves your computer. The first visit reads about 250 MB of index data and
            takes a few seconds; later visits are quick. Works in Chrome and Edge on a Mac; Windows is untested.
          </p>
          {phase.kind === 'opening' && (
            <p class="dim" id="status">
              {phase.message}
            </p>
          )}
          {phase.kind === 'error' && (
            <p class="bad" id="status">
              {phase.message}
            </p>
          )}
        </section>
      )}

      {phase.kind === 'ready' && (
        <>
          <Viewer key={phase.opened.info.buildKey + phase.opened.info.product} data={data.current} />
          <FolderDetails
            opened={phase.opened}
            dragging={dragging}
            chooser={chooser('Use another folder…')}
            onProduct={(product) => void openFolder(phase.files, product)}
          />
        </>
      )}

      <footer class="dim small">
        <p>
          Mogshot is a fan project. It is not affiliated with or endorsed by Blizzard Entertainment. World of
          Warcraft is a trademark of Blizzard Entertainment, Inc. Game files are read in your browser and never
          leave your computer; nothing of Blizzard's is stored on this site.
        </p>
        <p>
          <a href="https://github.com/realworldbuilder/mogshot">Source on GitHub</a> ·{' '}
          <a href="https://github.com/realworldbuilder/mogshot/issues">Report a problem</a>
        </p>
      </footer>
    </>
  );
}
