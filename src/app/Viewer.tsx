import { useEffect, useRef, useState } from 'preact/hooks';
import type { Option } from '../character/appearance';
import type { ItemSummary, Slot } from '../character/equipment';
import type { PosePreset } from '../character/poses';
import type { AnimationInfo, PoseInfo, PoseRequest } from '../character/scene';
import type { ImportedRecord } from '../import/record';
import type { Image } from '../formats/blp';
import type { ImportResult } from '../import/resolve';
import { type Backdrop, backdropImage, CLASSIC_SCREEN_ASPECT, composeBackdrop, GRADIENTS, MAX_BLUR, NO_BACKDROP, slug } from '../render/backdrop';
import { encodePng, unpremultiply } from '../render/export';
import { type Camera, CharacterRenderer, DEFAULT_CAMERA } from '../render/renderer';
import type { LoadingScreen, Race } from '../worker/api';
import type { DataClient } from '../worker/client';
import { messageOf } from './App';
import { GearPanel } from './GearPanel';
import { ImportPanel } from './ImportPanel';

const SEX_NAMES = ['Male', 'Female'];

/** The pictures that can be saved. A fixed-size picture shows what the preview shows; a tight crop fits the character. */
const SIZES = [
  { id: 'tight', name: 'Tight crop (4K tall or wide)', width: 2880, height: 3840, tight: true },
  { id: '4k', name: '4K (3840 × 2160)', width: 3840, height: 2160, tight: false },
  { id: '1080p', name: '1080p (1920 × 1080)', width: 1920, height: 1080, tight: false },
  { id: 'youtube', name: 'YouTube thumbnail (1280 × 720)', width: 1280, height: 720, tight: false },
  { id: 'square', name: 'Square (2160 × 2160)', width: 2160, height: 2160, tight: false },
] as const;
type Size = (typeof SIZES)[number];

/** Pixel size of the preview for a picture shape: about a million pixels, sharp on a high-density screen. */
function previewSize(size: Size): { width: number; height: number } {
  const aspect = size.width / size.height;
  const height = Math.round(Math.sqrt(1_100_000 / aspect) / 2) * 2;
  return { width: Math.round((height * aspect) / 2) * 2, height };
}


const BACKDROP_KINDS = new Set(['none', 'colour', 'gradient', 'screen']);

/** A remembered backdrop, or none if it is not one this version knows. */
function validBackdrop(value: unknown): Backdrop {
  if (typeof value === 'object' && value !== null && BACKDROP_KINDS.has((value as Backdrop).kind)) return value as Backdrop;
  return NO_BACKDROP;
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

interface Character {
  raceId: number;
  sex: number;
  choices: [number, number][];
}

/** What is drawn at the moment, as returned by the worker. */
interface Shown {
  /** Counts the pictures drawn, so a change on screen can be told from the one before. */
  drawn: number;
  options: Option[];
  choices: Map<number, number>;
  problems: string[];
  animations: AnimationInfo[];
  presets: PosePreset[];
  ms: number;
}

/** What a returning visitor left on screen, kept in the browser. */
interface Remembered {
  raceId: number;
  sex: number;
  choices: [number, number][];
  gear: [Slot, ItemSummary][];
  pose: PoseRequest;
  size: Size['id'];
  classId?: number;
  /** `Name-Realm` of the imported character on screen, if it was one. */
  imported?: string;
  backdrop?: Backdrop;
}

const REMEMBER_KEY = 'mogshot.character';
/** The look given to each imported character, by `Name-Realm`, so a face set by eye survives a re-import. */
const LOOKS_KEY = 'mogshot.looks';

type Looks = Record<string, [number, number][]>;

function rememberedLooks(): Looks {
  try {
    const text = localStorage.getItem(LOOKS_KEY);
    return text ? (JSON.parse(text) as Looks) : {};
  } catch {
    return {};
  }
}

function rememberLook(key: string, choices: [number, number][]): void {
  try {
    localStorage.setItem(LOOKS_KEY, JSON.stringify({ ...rememberedLooks(), [key]: choices }));
  } catch {
    // Private windows and full storage: the look is simply not remembered.
  }
}

function remembered(): Remembered | undefined {
  try {
    const text = localStorage.getItem(REMEMBER_KEY);
    return text ? (JSON.parse(text) as Remembered) : undefined;
  } catch {
    return undefined;
  }
}

function remember(value: Remembered): void {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(value));
  } catch {
    // Private windows and full storage: the character is simply not remembered.
  }
}

interface ViewerProps {
  data: DataClient;
  /** The characters the addon captured, found in the folder. */
  records: ImportedRecord[];
  recordsError?: string;
}

export function Viewer({ data, records, recordsError }: ViewerProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<CharacterRenderer>(null);
  const request = useRef(0);
  // The pose to rebuild the character in when its race, looks or gear change.
  const previous = useRef(remembered());
  const poseRequest = useRef<PoseRequest>(previous.current?.pose ?? { preset: 'Stand' });
  const camera = useRef<Camera>({ ...DEFAULT_CAMERA });
  // Posing while a pose is still being computed: only the newest request is sent next.
  const posing = useRef<{ busy: boolean; next?: { sequence: number; time: number } }>({ busy: false });

  const [races, setRaces] = useState<Race[]>();
  const [character, setCharacter] = useState<Character>();
  const [classId, setClassId] = useState<number | undefined>(previous.current?.classId);
  const [importedKey, setImportedKey] = useState<string | undefined>(previous.current?.imported);
  // What is worn stays on when the race or sex changes.
  const [gear, setGear] = useState<ReadonlyMap<Slot, ItemSummary>>(new Map(previous.current?.gear ?? []));
  const [shown, setShown] = useState<Shown>();
  const [pose, setPose] = useState<PoseInfo>();
  const [fov, setFov] = useState(30);
  const [size, setSize] = useState<Size>(SIZES.find((s) => s.id === previous.current?.size) ?? SIZES[0]);
  const [racesError, setRacesError] = useState<string>();
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string>();
  const [exportNote, setExportNote] = useState<{ text: string; bad: boolean }>();
  const [exporting, setExporting] = useState(false);
  const [backdrop, setBackdrop] = useState<Backdrop>(validBackdrop(previous.current?.backdrop));
  const [screens, setScreens] = useState<LoadingScreen[]>([]);
  const [backdropNote, setBackdropNote] = useState<string>();
  // Loading screens read so far, by file; undefined for one that could not be read.
  const screenImages = useRef(new Map<number, Image | undefined>());
  const [screensRead, setScreensRead] = useState(0);
  // The backdrop as drawn behind the preview, kept to give a renderer created later.
  const backdropSource = useRef<ReturnType<typeof composeBackdrop>>(undefined);

  const redraw = () => renderer.current?.render(camera.current);

  // The races the game lets you create. Start where the last visit left off, else on a human male.
  const loadRaces = () => {
    setRacesError(undefined);
    data
      .races()
      .then((list) => {
        setRaces(list);
        const last = previous.current;
        const lastRace = list.find((race) => race.id === last?.raceId);
        if (lastRace && last) {
          setCharacter({ raceId: lastRace.id, sex: lastRace.sexes.includes(last.sex) ? last.sex : (lastRace.sexes[0] ?? 0), choices: last.choices });
          return;
        }
        const first = list.find((race) => race.name === 'Human') ?? list[0];
        if (first) setCharacter({ raceId: first.id, sex: first.sexes[0] ?? 0, choices: [] });
        else setRacesError('The game data lists no races a player can create.');
      })
      .catch((cause) => setRacesError(messageOf(cause)));
  };
  useEffect(loadRaces, [data]);

  // Keep what is on screen for the next visit.
  useEffect(() => {
    if (!character || !shown) return;
    remember({
      raceId: character.raceId,
      sex: character.sex,
      choices: [...shown.choices],
      gear: [...gear],
      pose: poseRequest.current,
      size: size.id,
      classId,
      imported: importedKey,
      backdrop,
    });
    if (importedKey) rememberLook(importedKey, [...shown.choices]);
  }, [character, shown, gear, size, pose, classId, importedKey, backdrop]);

  // The game's loading screens, offered as backdrops.
  useEffect(() => {
    data
      .backdrops()
      .then(setScreens)
      .catch((cause) => setBackdropNote(`The game's loading screens could not be listed: ${messageOf(cause)}`));
  }, [data]);

  /** Show an imported character: the captured look if there is one, else the look last given to this character. */
  const showImported = (result: ImportResult, record: ImportedRecord) => {
    const choices = result.choices.length > 0 ? result.choices : (rememberedLooks()[record.key] ?? []);
    setCharacter({ raceId: result.raceId, sex: result.sex, choices });
    setGear(new Map(result.gear));
    if (result.classId !== undefined) setClassId(result.classId);
    setImportedKey(record.key);
  };

  // Build and draw whenever the character changes. A newer request supersedes an older one.
  useEffect(() => {
    if (!character) return;
    const id = ++request.current;
    setBuilding(true);
    data
      .character(
        character.raceId,
        character.sex,
        character.choices,
        [...gear].map(([slot, item]) => [slot, item.id]),
        poseRequest.current,
      )
      .then((built) => {
        if (id !== request.current || !canvas.current) return;
        renderer.current ??= new CharacterRenderer(canvas.current);
        renderer.current.setScene(built.scene);
        renderer.current.setBackdrop(backdropSource.current);
        redraw();
        setShown({
          drawn: id,
          options: built.scene.options,
          choices: new Map(built.scene.choices),
          problems: [...built.scene.problems, ...renderer.current.problems],
          animations: built.scene.animations,
          presets: built.scene.presets,
          ms: built.ms,
        });
        setPose(built.scene.pose);
        setError(undefined);
      })
      .catch((cause) => {
        if (id === request.current) setError(messageOf(cause));
      })
      .finally(() => {
        if (id === request.current) setBuilding(false);
      });
  }, [data, character, gear]);

  // The preview takes the shape of the picture that will be saved.
  const preview = previewSize(size);
  useEffect(redraw, [preview.width, preview.height]);

  const screenName = (fileId: number) => screens.find((s) => s.fileId === fileId)?.name ?? `file ${fileId}`;
  const screenImage = () => (backdrop.kind === 'screen' ? screenImages.current.get(backdrop.fileId) : undefined);
  /** The shape a loading screen is shown at: classic ones are squares stretched to 4:3. */
  const screenAspect = () =>
    backdrop.kind === 'screen' && !screens.find((s) => s.fileId === backdrop.fileId)?.wide ? CLASSIC_SCREEN_ASPECT : undefined;
  /** Composes the backdrop at a size: the preview's, or the picture's. */
  const compose = (width: number, height: number) => composeBackdrop(backdrop, width, height, screenImage(), screenAspect());

  // Compose the backdrop behind the preview whenever it or the preview's shape changes.
  useEffect(() => {
    if (backdrop.kind === 'screen') {
      const { fileId } = backdrop;
      if (!screenImages.current.has(fileId)) {
        // Read the picture; the previous backdrop stays until it arrives.
        data
          .icon(fileId)
          .then((image) => screenImages.current.set(fileId, image))
          .catch(() => screenImages.current.set(fileId, undefined))
          .finally(() => setScreensRead((count) => count + 1));
        return;
      }
      if (!screenImages.current.get(fileId)) {
        setBackdropNote(`The ${screenName(fileId)} loading screen could not be read. The picture has no backdrop.`);
        backdropSource.current = undefined;
        renderer.current?.setBackdrop(undefined);
        redraw();
        return;
      }
    }
    setBackdropNote(undefined);
    backdropSource.current = compose(preview.width, preview.height);
    renderer.current?.setBackdrop(backdropSource.current);
    redraw();
  }, [backdrop, preview.width, preview.height, screensRead, screens]);

  /** Change the backdrop from the select, keeping the sliders' settings where they still apply. */
  const pickBackdrop = (value: string) => {
    const vignette = backdrop.kind === 'none' ? undefined : backdrop.vignette;
    if (value === 'none') setBackdrop(NO_BACKDROP);
    else if (value === 'colour') {
      setBackdrop({ kind: 'colour', colour: backdrop.kind === 'colour' ? backdrop.colour : '#1c1f26', vignette: vignette ?? 0 });
    } else if (value.startsWith('gradient:')) {
      const preset = GRADIENTS.find((g) => g.name === value.slice('gradient:'.length));
      const was = backdrop.kind === 'gradient' ? backdrop : undefined;
      setBackdrop({
        kind: 'gradient',
        from: preset?.from ?? was?.from ?? GRADIENTS[0].from,
        to: preset?.to ?? was?.to ?? GRADIENTS[0].to,
        shape: was?.shape ?? 'radial',
        vignette: vignette ?? 0,
      });
    } else if (value.startsWith('screen:')) {
      const was = backdrop.kind === 'screen' ? backdrop : undefined;
      setBackdrop({ kind: 'screen', fileId: Number(value.slice('screen:'.length)), blur: was?.blur ?? 0, vignette: was?.vignette ?? 0.4 });
    }
  };

  /** A short name for the backdrop, for file names. */
  const backdropName = (): string => {
    switch (backdrop.kind) {
      case 'none':
        return 'none';
      case 'colour':
        return 'colour';
      case 'gradient':
        return slug(GRADIENTS.find((g) => g.from === backdrop.from && g.to === backdrop.to)?.name ?? 'gradient');
      case 'screen':
        return slug(screenName(backdrop.fileId));
    }
  };

  // Camera: drag to turn, shift-drag (or right-drag) to slide, wheel to zoom.
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    let dragging: { x: number; y: number; pan: boolean } | undefined;
    const down = (event: PointerEvent) => {
      dragging = { x: event.clientX, y: event.clientY, pan: event.shiftKey || event.button === 2 };
      target.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - dragging.x;
      const dy = event.clientY - dragging.y;
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      const view = camera.current;
      if (dragging.pan) {
        const perPixel = 2 / target.clientHeight;
        view.panX += dx * perPixel;
        view.panY -= dy * perPixel;
      } else {
        view.yaw -= dx * 0.01;
        view.pitch = Math.min(1.45, Math.max(-1.45, view.pitch + dy * 0.01));
      }
      redraw();
    };
    const up = () => (dragging = undefined);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = camera.current;
      view.zoom = Math.min(4, Math.max(0.1, view.zoom * Math.exp(event.deltaY * 0.0015)));
      redraw();
    };
    const menu = (event: Event) => event.preventDefault();
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener('wheel', wheel, { passive: false });
    target.addEventListener('contextmenu', menu);
    return () => {
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      target.removeEventListener('wheel', wheel);
      target.removeEventListener('contextmenu', menu);
    };
  }, [races, character]);

  const race = races?.find((r) => r.id === character?.raceId);

  const choose = (optionId: number, choiceId: number) => {
    if (!character || !shown) return;
    const choices = new Map(shown.choices);
    choices.set(optionId, choiceId);
    setCharacter({ ...character, choices: [...choices] });
  };

  /** Move the character on screen to a moment of one of its animations. */
  const poseAt = (sequence: number, time: number, remember: PoseRequest) => {
    poseRequest.current = remember;
    const send = async (next: { sequence: number; time: number }) => {
      posing.current.busy = true;
      try {
        const result = await data.pose(next.sequence, next.time);
        renderer.current?.setPose(result);
        redraw();
        setPose({ ...result.pose, preset: 'preset' in poseRequest.current ? poseRequest.current.preset : undefined });
        setError(undefined);
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        posing.current.busy = false;
        const waiting = posing.current.next;
        posing.current.next = undefined;
        if (waiting) void send(waiting);
      }
    };
    if (posing.current.busy) posing.current.next = { sequence, time };
    else void send({ sequence, time });
  };

  const animation = shown?.animations.find((a) => a.sequence === pose?.sequence);
  const scrubTo = (sequence: number, time: number) => {
    const target = shown?.animations.find((a) => a.sequence === sequence);
    if (target) poseAt(sequence, time, { animationId: target.id, variation: target.variation, time });
  };

  /** Whether the picture saved has a backdrop; a backdrop that could not be read leaves it transparent. */
  const hasBackdrop = backdrop.kind !== 'none' && (backdrop.kind !== 'screen' || screenImage() !== undefined);

  /** The picture as PNG bytes, at the chosen size. With a backdrop the whole preview is saved, uncropped. */
  const picture = async () => {
    const view = renderer.current!;
    // The preview's backdrop is small; the picture gets one composed at its own size.
    if (hasBackdrop) view.setBackdrop(compose(size.width, size.height));
    try {
      const image = view.renderImage(camera.current, {
        longSide: Math.max(size.width, size.height),
        aspect: size.tight && !hasBackdrop ? preview.width / preview.height : size.width / size.height,
        tight: size.tight && !hasBackdrop,
      });
      unpremultiply(image.pixels);
      return { image, png: await encodePng(image) };
    } finally {
      if (hasBackdrop) view.setBackdrop(backdropSource.current);
    }
  };

  const download = (png: Uint8Array, name: string) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  };

  const exportNoteFor = (what: string, image: Image, png: Uint8Array, start: number) =>
    `${what} ${image.width.toLocaleString()} × ${image.height.toLocaleString()} pixels ` +
    `(${(png.length / 1024 / 1024).toFixed(1)} MB) in ${((performance.now() - start) / 1000).toFixed(1)} s.`;

  const save = async (how: 'download' | 'copy') => {
    if (!renderer.current || !race || !character) return;
    setExporting(true);
    try {
      const start = performance.now();
      const { image, png } = await picture();
      if (how === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })]);
      } else {
        download(png, `mogshot-${slug(`${race.name} ${SEX_NAMES[character.sex]}`)}.png`);
      }
      setExportNote({ bad: false, text: exportNoteFor(how === 'copy' ? 'Copied' : 'Saved', image, png, start) });
    } catch (cause) {
      setExportNote({ bad: true, text: `The picture could not be ${how === 'copy' ? 'copied' : 'exported'}: ${messageOf(cause)}` });
    } finally {
      setExporting(false);
    }
  };

  /** Save the backdrop by itself, at the picture's size, to layer under a transparent character. */
  const saveBackdrop = async () => {
    setExporting(true);
    try {
      const start = performance.now();
      const canvas = compose(size.width, size.height);
      if (!canvas) return;
      const image = backdropImage(canvas);
      const png = await encodePng(image);
      download(png, `mogshot-backdrop-${backdropName()}.png`);
      setExportNote({ bad: false, text: exportNoteFor('Saved the backdrop alone,', image, png, start) });
    } catch (cause) {
      setExportNote({ bad: true, text: `The backdrop could not be exported: ${messageOf(cause)}` });
    } finally {
      setExporting(false);
    }
  };

  // Animations in name order; the variations of one animation are numbered.
  const animations = [...(shown?.animations ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.variation - b.variation);

  return (
    <section class="panel" id="character">
      {(error ?? racesError) && (
        <p class="bad" id="character-error">
          The character could not be drawn: {error ?? racesError}{' '}
          <button class="plain" id="retry" onClick={() => (races ? setCharacter(character && { ...character }) : loadRaces())}>
            Try again
          </button>
        </p>
      )}
      {!races && !racesError && <p class="dim">Reading the game database…</p>}
      {races && character && (
        <div class="viewer">
          <div>
            <div class="stage">
              <canvas
                id="canvas"
                ref={canvas}
                width={preview.width}
                height={preview.height}
                class={building ? 'building' : ''}
                data-drawn={shown?.drawn ?? 0}
                data-pose={pose ? `${pose.sequence}:${pose.time}` : ''}
                data-backdrop={hasBackdrop ? backdropName() : ''}
              />
            </div>
            <p class="dim small hint">
              Drag to turn, shift-drag to slide, scroll to zoom.{' '}
              {hasBackdrop ? 'The backdrop is part of the picture.' : 'The grey squares are transparency.'}
            </p>

            <div class="pose" id="pose">
              <div class="presets" id="presets">
                {shown?.presets.map((preset) => (
                  <button
                    key={preset.name}
                    class={pose?.preset === preset.name ? 'on' : ''}
                    onClick={() => poseAt(preset.sequence, preset.time, { preset: preset.name })}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <div class="scrub">
                <select
                  id="animation"
                  aria-label="Animation"
                  value={pose?.sequence}
                  onChange={(event) => scrubTo(Number(event.currentTarget.value), 0)}
                >
                  {animations.map((a) => (
                    <option value={a.sequence}>
                      {a.name}
                      {a.variation > 0 ? ` (${a.variation + 1})` : ''}
                    </option>
                  ))}
                </select>
                <input
                  id="time"
                  type="range"
                  aria-label="Moment in the animation"
                  min={0}
                  max={pose?.duration ?? 0}
                  step={1}
                  value={pose?.time ?? 0}
                  disabled={!animation}
                  onInput={(event) => pose && scrubTo(pose.sequence, Number(event.currentTarget.value))}
                />
                <span class="dim small" id="time-label">
                  {pose ? `${(pose.time / 1000).toFixed(2)} of ${(pose.duration / 1000).toFixed(2)} s` : ''}
                </span>
              </div>
              <div class="scrub">
                <label class="small" for="fov">
                  Lens
                </label>
                <input
                  id="fov"
                  type="range"
                  min={10}
                  max={70}
                  step={1}
                  value={fov}
                  onInput={(event) => {
                    const degrees = Number(event.currentTarget.value);
                    setFov(degrees);
                    camera.current.fov = (degrees * Math.PI) / 180;
                    redraw();
                  }}
                />
                <span class="dim small">{fov}° {fov <= 20 ? '(flat)' : fov >= 50 ? '(wide)' : ''}</span>
                <button
                  class="plain"
                  id="reset-view"
                  onClick={() => {
                    camera.current = { ...DEFAULT_CAMERA };
                    setFov(30);
                    redraw();
                  }}
                >
                  Reset view
                </button>
              </div>
            </div>

            <div class="pose" id="backdrop">
              <div class="scrub">
                <label class="small" for="backdrop-kind">
                  Backdrop
                </label>
                <select id="backdrop-kind" value={backdropValue(backdrop)} onChange={(event) => pickBackdrop(event.currentTarget.value)}>
                  <option value="none">None (transparent)</option>
                  <option value="colour">Colour</option>
                  <optgroup label="Gradient">
                    {GRADIENTS.map((g) => (
                      <option value={`gradient:${g.name}`}>{g.name}</option>
                    ))}
                    <option value="gradient:custom">Custom colours</option>
                  </optgroup>
                  {screens.length > 0 && (
                    <optgroup label="Loading screen">
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
                    onInput={(event) => setBackdrop({ ...backdrop, colour: event.currentTarget.value })}
                  />
                )}
                {backdrop.kind === 'gradient' && (
                  <>
                    <input
                      type="color"
                      id="gradient-from"
                      aria-label="Colour behind the character"
                      value={backdrop.from}
                      onInput={(event) => setBackdrop({ ...backdrop, from: event.currentTarget.value })}
                    />
                    <input
                      type="color"
                      id="gradient-to"
                      aria-label="Colour at the edges"
                      value={backdrop.to}
                      onInput={(event) => setBackdrop({ ...backdrop, to: event.currentTarget.value })}
                    />
                    <select
                      id="gradient-shape"
                      class="short"
                      aria-label="Gradient shape"
                      value={backdrop.shape}
                      onChange={(event) => setBackdrop({ ...backdrop, shape: event.currentTarget.value as 'radial' | 'vertical' })}
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
                        onInput={(event) => setBackdrop({ ...backdrop, blur: Number(event.currentTarget.value) })}
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
                    onInput={(event) => setBackdrop({ ...backdrop, vignette: Number(event.currentTarget.value) / 100 })}
                  />
                </div>
              )}
              {backdropNote && (
                <p class="bad small" id="backdrop-note">
                  {backdropNote}
                </p>
              )}
            </div>

            <div class="actions">
              <select
                id="size"
                aria-label="Picture size"
                value={size.id}
                onChange={(event) => setSize(SIZES.find((s) => s.id === event.currentTarget.value) ?? SIZES[0])}
              >
                {SIZES.map((s) => (
                  <option value={s.id}>{s.name}</option>
                ))}
              </select>
              <button class="primary" id="download" disabled={exporting || !shown} onClick={() => save('download')}>
                Download PNG
              </button>
              <button class="plain" id="copy" disabled={exporting || !shown} onClick={() => save('copy')}>
                Copy
              </button>
              {hasBackdrop && (
                <button class="plain" id="download-backdrop" disabled={exporting} onClick={saveBackdrop}>
                  Backdrop only
                </button>
              )}
            </div>
            <p class={`${exportNote?.bad ? 'bad' : 'dim'} small`} id="export-note">
              {exportNote?.text ??
                (hasBackdrop
                  ? 'A PNG with the backdrop behind the character. Backdrop only saves the backdrop by itself, to layer under a transparent character in Canva.'
                  : 'A transparent PNG. Copy puts it on the clipboard, ready to paste into Canva or an editor.')}
            </p>
            {shown && shown.problems.length > 0 && (
              <div id="character-problems">
                <p class="bad small">This picture is missing something. A download will be missing it too:</p>
                <ul class="small">
                  {shown.problems.map((problem) => (
                    <li>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div class="controls">
            <span class="column-title">Character</span>
            <ImportPanel data={data} records={records} recordsError={recordsError} selectedKey={importedKey} onImport={showImported} />
            <label class="field">
              <span>Race</span>
              <select
                id="race"
                value={character.raceId}
                onChange={(event) => {
                  const next = races.find((r) => r.id === Number(event.currentTarget.value))!;
                  const sex = next.sexes.includes(character.sex) ? character.sex : (next.sexes[0] ?? 0);
                  setCharacter({ raceId: next.id, sex, choices: [] });
                  setImportedKey(undefined);
                }}
              >
                {races.map((r) => (
                  <option value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>
            <div class="field">
              <span>Sex</span>
              <div class="segments" id="sex">
                {(race?.sexes ?? []).map((sex) => (
                  <button
                    class={sex === character.sex ? 'on' : ''}
                    onClick={() => {
                      setCharacter({ raceId: character.raceId, sex, choices: [] });
                      setImportedKey(undefined);
                    }}
                  >
                    {SEX_NAMES[sex]}
                  </button>
                ))}
              </div>
            </div>
            <div class="shortcuts">
              <button
                class="plain"
                id="random-look"
                disabled={!shown}
                onClick={() => {
                  if (!shown) return;
                  // A random available choice for every option the game offers.
                  const choices: [number, number][] = [];
                  for (const option of shown.options) {
                    if (option.hidden) continue;
                    const pool = option.choices.filter((choice) => choice.available);
                    const pick = pool[Math.floor(Math.random() * pool.length)];
                    if (pick) choices.push([option.id, pick.id]);
                  }
                  setCharacter({ ...character, choices });
                }}
              >
                Random look
              </button>
              <button
                class="plain"
                id="default-look"
                disabled={!shown || character.choices.length === 0}
                onClick={() => setCharacter({ ...character, choices: [] })}
              >
                Default look
              </button>
            </div>

            {shown?.options
              .filter((option) => !option.hidden)
              .map((option) => {
                const current = shown.choices.get(option.id);
                // Choices only non-player characters or special classes can use are left out.
                const choices = option.choices.filter((choice) => choice.available || choice.id === current);
                let unnamed = 0;
                // Colour options show their colours; everything else is a list.
                if (choices.length > 0 && choices.every((choice) => choice.swatches.length > 0)) {
                  return (
                    <div class="field" key={option.id}>
                      <span>{option.name}</span>
                      <div class="swatches" data-option={option.name} role="radiogroup">
                        {choices.map((choice, i) => (
                          <button
                            role="radio"
                            aria-checked={choice.id === current}
                            class={choice.id === current ? 'on' : ''}
                            title={choice.name || `${option.name} ${i + 1}`}
                            style={{
                              background:
                                choice.swatches.length > 1
                                  ? `linear-gradient(135deg, ${choice.swatches[0]} 50%, ${choice.swatches[1]} 50%)`
                                  : choice.swatches[0],
                            }}
                            onClick={() => choose(option.id, choice.id)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                }
                return (
                  <label class="field" key={option.id}>
                    <span>{option.name}</span>
                    <select
                      data-option={option.name}
                      value={current}
                      onChange={(event) => choose(option.id, Number(event.currentTarget.value))}
                    >
                      {choices.map((choice) => (
                        <option value={choice.id}>{choice.name || String(++unnamed)}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            {shown && (
              <p class="dim small" id="character-note">
                Built in {(shown.ms / 1000).toFixed(1)} s.
              </p>
            )}
          </div>

          <div class="controls">
            <span class="column-title">Gear</span>
            <GearPanel
              data={data}
              raceId={character.raceId}
              classId={classId}
              onClass={setClassId}
              gear={gear}
              onChange={(slot, item) => {
                const next = new Map(gear);
                if (item) next.set(slot, item);
                else next.delete(slot);
                setGear(next);
              }}
              onOutfit={(outfit) => setGear(new Map(outfit))}
            />
          </div>
        </div>
      )}
    </section>
  );
}
