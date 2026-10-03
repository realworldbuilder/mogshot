import { useEffect, useState } from 'preact/hooks';
import type { Image } from '../formats/blp';
import { type Backdrop, CLASSIC_SCREEN_ASPECT, composeBackdrop, GRADIENTS, MAX_BLUR, NO_BACKDROP, slug } from '../render/backdrop';
import type { LoadingScreen } from '../worker/api';

/*
 * The backdrop setting is shared by the Character tab (drawn behind the character) and
 * the Backdrop tab (made and saved by itself), and kept in the browser.
 */

const BACKDROP_KEY = 'mogshot.backdrop';
const BACKDROP_KINDS = new Set(['none', 'colour', 'gradient', 'screen']);

/** A remembered backdrop, or none if it is not one this version knows. */
function validBackdrop(value: unknown): Backdrop {
  if (typeof value === 'object' && value !== null && BACKDROP_KINDS.has((value as Backdrop).kind)) return value as Backdrop;
  return NO_BACKDROP;
}

export function rememberedBackdrop(): Backdrop {
  try {
    const own = localStorage.getItem(BACKDROP_KEY);
    if (own) return validBackdrop(JSON.parse(own));
    // Earlier versions kept it with the character.
    const character = localStorage.getItem('mogshot.character');
    return validBackdrop(character ? (JSON.parse(character) as { backdrop?: unknown }).backdrop : undefined);
  } catch {
    return NO_BACKDROP;
  }
}

export function rememberBackdrop(backdrop: Backdrop): void {
  try {
    localStorage.setItem(BACKDROP_KEY, JSON.stringify(backdrop));
  } catch {
    // Private windows and full storage: the backdrop is simply not remembered.
  }
}

/** Reads a loading screen's pixels from the open folder; undefined when the file cannot be read. */
export type LoadScreen = (fileId: number) => Promise<Image | undefined>;

export interface ScreenState {
  /**
   * `none`: the backdrop is not a loading screen. `closed`: no game folder is open to read it from.
   * `pending`: being read. `ready`: `image` holds it. `failed`: the file could not be read.
   */
  state: 'none' | 'closed' | 'pending' | 'ready' | 'failed';
  image?: Image;
}

/** The pixels of the loading screen a backdrop names. */
export function useScreen(backdrop: Backdrop, loadScreen: LoadScreen | undefined): ScreenState {
  const fileId = backdrop.kind === 'screen' ? backdrop.fileId : undefined;
  const [read, setRead] = useState<{ fileId: number; from: LoadScreen; image: Image | undefined }>();
  useEffect(() => {
    if (fileId === undefined || !loadScreen) return;
    let stale = false;
    void loadScreen(fileId).then((image) => {
      if (!stale) setRead({ fileId, from: loadScreen, image });
    });
    return () => {
      stale = true;
    };
  }, [fileId, loadScreen]);
  if (fileId === undefined) return { state: 'none' };
  if (!loadScreen) return { state: 'closed' };
  if (read?.fileId !== fileId || read.from !== loadScreen) return { state: 'pending' };
  return read.image ? { state: 'ready', image: read.image } : { state: 'failed' };
}

/** Whether there is a backdrop to draw: one is chosen, and a loading screen's pixels are in hand. */
export const drawable = (backdrop: Backdrop, screen: ScreenState): boolean =>
  backdrop.kind !== 'none' && (backdrop.kind !== 'screen' || screen.state === 'ready');

/** Draw the backdrop at a size, or undefined when there is nothing to draw. */
export function compose(backdrop: Backdrop, screen: ScreenState, screens: readonly LoadingScreen[], width: number, height: number) {
  if (!drawable(backdrop, screen)) return undefined;
  // Classic screens are squares the game stretches to 4:3.
  const classic = backdrop.kind === 'screen' && !screens.find((s) => s.fileId === backdrop.fileId)?.wide;
  return composeBackdrop(backdrop, width, height, screen.image, classic ? CLASSIC_SCREEN_ASPECT : undefined);
}

const screenName = (fileId: number, screens: readonly LoadingScreen[]) => screens.find((s) => s.fileId === fileId)?.name;

/** A short name for the backdrop, for file names. */
export function backdropName(backdrop: Backdrop, screens: readonly LoadingScreen[]): string {
  switch (backdrop.kind) {
    case 'none':
      return 'none';
    case 'colour':
      return 'colour';
    case 'gradient':
      return slug(GRADIENTS.find((g) => g.from === backdrop.from && g.to === backdrop.to)?.name ?? 'gradient');
    case 'screen':
      return slug(screenName(backdrop.fileId, screens) ?? 'loading-screen');
  }
}

/** What to tell the user when the chosen loading screen cannot be shown, if anything. */
export function screenProblem(backdrop: Backdrop, screen: ScreenState, screens: readonly LoadingScreen[]): string | undefined {
  if (backdrop.kind !== 'screen') return undefined;
  const name = screenName(backdrop.fileId, screens) ?? `file ${backdrop.fileId}`;
  if (screen.state === 'failed') return `The ${name} loading screen could not be read. The picture has no backdrop.`;
  return undefined;
}

/** The value of the backdrop select for a backdrop. */
function backdropValue(backdrop: Backdrop): string {
  switch (backdrop.kind) {
    case 'none':
    case 'colour':
      return backdrop.kind;
    case 'gradient': {
      const preset = GRADIENTS.find((g) => g.from === backdrop.from && g.to === backdrop.to);
      return `gradient:${preset?.name ?? 'custom'}`;
    }
    case 'screen':
      return `screen:${backdrop.fileId}`;
  }
}

interface BackdropControlsProps {
  backdrop: Backdrop;
  onChange: (backdrop: Backdrop) => void;
  /** The game's loading screens; empty until a folder is open. */
  screens: readonly LoadingScreen[];
  /** Something wrong with the backdrop, said in words. */
  problem?: string;
}

/** The select, colours and sliders that set the backdrop. */
export function BackdropControls({ backdrop, onChange, screens, problem }: BackdropControlsProps) {
  /** Change the kind from the select, keeping the sliders' settings where they still apply. */
  const pick = (value: string) => {
    const vignette = backdrop.kind === 'none' ? undefined : backdrop.vignette;
    if (value === 'none') onChange(NO_BACKDROP);
    else if (value === 'colour') {
      onChange({ kind: 'colour', colour: backdrop.kind === 'colour' ? backdrop.colour : '#1c1f26', vignette: vignette ?? 0 });
    } else if (value.startsWith('gradient:')) {
      const preset = GRADIENTS.find((g) => g.name === value.slice('gradient:'.length));
      const was = backdrop.kind === 'gradient' ? backdrop : undefined;
      onChange({
        kind: 'gradient',
        from: preset?.from ?? was?.from ?? GRADIENTS[0].from,
        to: preset?.to ?? was?.to ?? GRADIENTS[0].to,
        shape: was?.shape ?? 'radial',
        vignette: vignette ?? 0,
      });
    } else if (value.startsWith('screen:')) {
      const was = backdrop.kind === 'screen' ? backdrop : undefined;
      onChange({ kind: 'screen', fileId: Number(value.slice('screen:'.length)), blur: was?.blur ?? 0, vignette: was?.vignette ?? 0.4 });
    }
  };
  // A remembered loading screen stays selectable while its folder is not open.
  const unlisted = backdrop.kind === 'screen' && !screens.some((s) => s.fileId === backdrop.fileId);

  return (
    <div class="pose" id="backdrop">
      <div class="scrub">
        <label class="small" for="backdrop-kind">
          Backdrop
        </label>
        <select id="backdrop-kind" value={backdropValue(backdrop)} onChange={(event) => pick(event.currentTarget.value)}>
          <option value="none">None (transparent)</option>
          <option value="colour">Colour</option>
          <optgroup label="Gradient">
            {GRADIENTS.map((g) => (
              <option value={`gradient:${g.name}`}>{g.name}</option>
            ))}
            <option value="gradient:custom">Custom colours</option>
          </optgroup>
          {(screens.length > 0 || unlisted) && (
            <optgroup label="Loading screen">
              {unlisted && backdrop.kind === 'screen' && <option value={`screen:${backdrop.fileId}`}>Loading screen (needs the game folder)</option>}
              {screens.map((s) => (
                <option value={`screen:${s.fileId}`}>{s.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        {backdrop.kind === 'colour' && (
          <input
            type="color"
            id="backdrop-colour"
            aria-label="Backdrop colour"
            value={backdrop.colour}
            onInput={(event) => onChange({ ...backdrop, colour: event.currentTarget.value })}
          />
        )}
        {backdrop.kind === 'gradient' && (
          <>
            <input
              type="color"
              id="gradient-from"
              aria-label="Colour behind the character"
              value={backdrop.from}
              onInput={(event) => onChange({ ...backdrop, from: event.currentTarget.value })}
            />
            <input
              type="color"
              id="gradient-to"
              aria-label="Colour at the edges"
              value={backdrop.to}
              onInput={(event) => onChange({ ...backdrop, to: event.currentTarget.value })}
            />
            <select
              id="gradient-shape"
              class="short"
              aria-label="Gradient shape"
              value={backdrop.shape}
              onChange={(event) => onChange({ ...backdrop, shape: event.currentTarget.value as 'radial' | 'vertical' })}
            >
              <option value="radial">Spotlight</option>
              <option value="vertical">Top to bottom</option>
            </select>
          </>
        )}
      </div>
      {backdrop.kind !== 'none' && (
        <div class="scrub" id="backdrop-adjust">
          {backdrop.kind === 'screen' && (
            <>
              <label class="small" for="blur">
                Blur
              </label>
              <input
                id="blur"
                type="range"
                min={0}
                max={MAX_BLUR}
                step={1}
                value={backdrop.blur}
                onInput={(event) => onChange({ ...backdrop, blur: Number(event.currentTarget.value) })}
              />
            </>
          )}
          <label class="small" for="vignette">
            Vignette
          </label>
          <input
            id="vignette"
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(backdrop.vignette * 100)}
            onInput={(event) => onChange({ ...backdrop, vignette: Number(event.currentTarget.value) / 100 })}
          />
        </div>
      )}
      {problem && (
        <p class="bad small" id="backdrop-note">
          {problem}
        </p>
      )}
    </div>
  );
}
