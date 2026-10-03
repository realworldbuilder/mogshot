import { useEffect, useRef, useState } from 'preact/hooks';
import { type Backdrop, backdropImage } from '../render/backdrop';
import { encodePng } from '../render/export';
import type { LoadingScreen } from '../worker/api';
import { messageOf } from './App';
import { BackdropControls, backdropName, compose, drawable, type LoadScreen, screenProblem, useScreen } from './BackdropControls';
import { downloadPng, previewSize, savedNote } from './sizes';

/** The sizes a backdrop can be saved at. */
const BACKDROP_SIZES = [
  { id: '4k', name: '4K (3840 × 2160)', width: 3840, height: 2160 },
  { id: 'portrait', name: 'Portrait 4K (2880 × 3840)', width: 2880, height: 3840 },
  { id: '1080p', name: '1080p (1920 × 1080)', width: 1920, height: 1080 },
  { id: 'youtube', name: 'YouTube thumbnail (1280 × 720)', width: 1280, height: 720 },
  { id: 'square', name: 'Square (2160 × 2160)', width: 2160, height: 2160 },
  { id: 'story', name: 'Story (2160 × 3840)', width: 2160, height: 3840 },
] as const;
type BackdropSize = (typeof BACKDROP_SIZES)[number];

const SIZE_KEY = 'mogshot.backdrop-size';

function rememberedSize(): BackdropSize {
  try {
    return BACKDROP_SIZES.find((s) => s.id === localStorage.getItem(SIZE_KEY)) ?? BACKDROP_SIZES[0];
  } catch {
    return BACKDROP_SIZES[0];
  }
}

interface BackdropPanelProps {
  backdrop: Backdrop;
  onChange: (backdrop: Backdrop) => void;
  screens: readonly LoadingScreen[];
  /** Reads a loading screen from the open folder; undefined while no folder is open. */
  loadScreen: LoadScreen | undefined;
  /** What the folder is doing, or how to add the game's loading screens, when they are not listed. */
  folderNote?: { text: string; bad: boolean };
}

/** The Backdrop tab: make a backdrop and save it by itself, with or without the game folder. */
export function BackdropPanel({ backdrop, onChange, screens, loadScreen, folderNote }: BackdropPanelProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<BackdropSize>(rememberedSize);
  const [note, setNote] = useState<{ text: string; bad: boolean }>();
  const [busy, setBusy] = useState(false);
  const screen = useScreen(backdrop, loadScreen);
  const ready = drawable(backdrop, screen);
  const preview = previewSize(size);

  useEffect(() => {
    try {
      localStorage.setItem(SIZE_KEY, size.id);
    } catch {
      // Not remembered.
    }
  }, [size]);

  // Show the backdrop in the picture's shape. While a loading screen is read, the last picture stays.
  useEffect(() => {
    const target = canvas.current?.getContext('2d');
    if (!target || screen.state === 'pending') return;
    target.clearRect(0, 0, preview.width, preview.height);
    const composed = compose(backdrop, screen, screens, preview.width, preview.height);
    if (composed) target.drawImage(composed, 0, 0);
  }, [backdrop, screen.state, screen.image, screens, preview.width, preview.height]);

  const save = async (how: 'download' | 'copy') => {
    setBusy(true);
    try {
      const start = performance.now();
      const composed = compose(backdrop, screen, screens, size.width, size.height);
      if (!composed) return;
      const image = backdropImage(composed);
      const png = await encodePng(image);
      if (how === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })]);
      } else downloadPng(png, `mogshot-backdrop-${backdropName(backdrop, screens)}.png`);
      setNote({ bad: false, text: savedNote(how === 'copy' ? 'Copied' : 'Saved', image, png, start) });
    } catch (cause) {
      setNote({ bad: true, text: `The backdrop could not be ${how === 'copy' ? 'copied' : 'exported'}: ${messageOf(cause)}` });
    } finally {
      setBusy(false);
    }
  };

  const waiting =
    backdrop.kind === 'none'
      ? 'Pick a backdrop below: a colour, a gradient, or one of the game\'s loading screens.'
      : screen.state === 'closed'
        ? 'This loading screen is read from your game folder. Open the folder to see it.'
        : undefined;

  return (
    <section class="panel" id="backdrop-tab">
      <h2>Make a backdrop</h2>
      <p class="dim small">
        A picture to put behind a character: saved by itself here, or drawn behind your character on the Character
        tab. Colours and gradients need nothing; the game's loading screens come from your World of Warcraft folder.
      </p>
      <div class="stage backdrop-stage">
        <canvas id="backdrop-canvas" ref={canvas} width={preview.width} height={preview.height} data-backdrop={ready ? backdropName(backdrop, screens) : ''} />
        {waiting && <p class="stage-note dim">{waiting}</p>}
      </div>

      <BackdropControls backdrop={backdrop} onChange={onChange} screens={screens} problem={screenProblem(backdrop, screen, screens)} />
      {screens.length === 0 && folderNote && (
        <p class={`${folderNote.bad ? 'bad' : 'dim'} small`} id="backdrop-folder-note">
          {folderNote.text}
        </p>
      )}

      <div class="actions">
        <select
          id="backdrop-size"
          aria-label="Backdrop size"
          value={size.id}
          onChange={(event) => setSize(BACKDROP_SIZES.find((s) => s.id === event.currentTarget.value) ?? BACKDROP_SIZES[0])}
        >
          {BACKDROP_SIZES.map((s) => (
            <option value={s.id}>{s.name}</option>
          ))}
        </select>
        <button class="primary" id="backdrop-download" disabled={busy || !ready} onClick={() => save('download')}>
          Download backdrop
        </button>
        <button class="plain" id="backdrop-copy" disabled={busy || !ready} onClick={() => save('copy')}>
          Copy
        </button>
      </div>
      <p class={`${note?.bad ? 'bad' : 'dim'} small`} id="backdrop-export-note">
        {note?.text ?? 'A PNG of the backdrop alone, to layer under a transparent character in Canva or an editor.'}
      </p>
    </section>
  );
}
