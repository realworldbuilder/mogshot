import { useEffect, useRef, useState } from 'preact/hooks';
import type { Option } from '../character/appearance';
import type { ItemSummary, Slot } from '../character/equipment';
import type { PosePreset } from '../character/poses';
import type { AnimationInfo, PoseInfo, PoseRequest } from '../character/scene';
import type { ImportedRecord } from '../import/record';
import type { ImportResult } from '../import/resolve';
import { type Backdrop, backdropImage, slug } from '../render/backdrop';
import { CLIP_FPS, CLIP_FORMATS, type ClipFormat, clipSize, clipTimes, encodeClip, GIF_FPS } from '../render/clip';
import { encodePng, unpremultiply } from '../render/export';
import { type Camera, CharacterRenderer, DEFAULT_CAMERA } from '../render/renderer';
import type { LoadingScreen, Race } from '../worker/api';
import type { DataClient } from '../worker/client';
import { messageOf } from './App';
import { BackdropControls, backdropName, compose, drawable, type LoadScreen, screenProblem, useScreen } from './BackdropControls';
import { GearPanel } from './GearPanel';
import { ImportPanel } from './ImportPanel';
import { type PlaceChoice, PlaceControls, recallPlace, rememberPlace } from './PlaceControls';
import { downloadFile, downloadPng, previewSize, savedNote, type Size, SIZES } from './sizes';

const SEX_NAMES = ['Male', 'Female'];
/** How many yards of world are drawn around the character. */
const PLACE_REACH = 450;

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
  /** False while another tab is shown: the viewer stays alive but leaves the shared controls to that tab. */
  active: boolean;
  /** What is drawn behind the character, shared with the Backdrop tab. */
  backdrop: Backdrop;
  onBackdrop: (backdrop: Backdrop) => void;
  screens: readonly LoadingScreen[];
  loadScreen: LoadScreen;
}

export function Viewer({ data, records, recordsError, active, backdrop, onBackdrop, screens, loadScreen }: ViewerProps) {
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
  const [playing, setPlaying] = useState(false);
  // The place in the game world the character stands in, and whether it is on screen yet.
  const [place, setPlace] = useState<PlaceChoice | undefined>(recallPlace);
  const [placed, setPlaced] = useState<{ state: 'none' | 'reading' | 'shown'; problem?: string }>({ state: 'none' });
  const placeRequest = useRef(0);
  const [clipFormat, setClipFormat] = useState<ClipFormat>('mp4');
  // The backdrop as drawn behind the preview, kept to give a renderer created later.
  const backdropSource = useRef<ReturnType<typeof compose>>(undefined);

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
    });
    if (importedKey) rememberLook(importedKey, [...shown.choices]);
  }, [character, shown, gear, size, pose, classId, importedKey]);

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

  const screen = useScreen(backdrop, loadScreen);
  /** Whether the picture saved has a backdrop; a loading screen that could not be read leaves it transparent. */
  const hasBackdrop = drawable(backdrop, screen);
  /** Composes the backdrop at a size: the preview's, or the picture's. */
  const composeAt = (width: number, height: number) => compose(backdrop, screen, screens, width, height);

  // Compose the backdrop behind the preview whenever it or the preview's shape changes.
  // While a loading screen is being read, the previous backdrop stays.
  useEffect(() => {
    if (screen.state === 'pending') return;
    backdropSource.current = composeAt(preview.width, preview.height);
    renderer.current?.setBackdrop(backdropSource.current);
    redraw();
  }, [backdrop, preview.width, preview.height, screen.state, screen.image, screens]);

  // Read the place whenever the spot or the facing changes. The blur alone does not need it read again.
  useEffect(() => {
    rememberPlace(place);
    const id = ++placeRequest.current;
    // Nothing to stand in a place until the first character is drawn.
    if (!renderer.current) return;
    if (!place) {
      renderer.current?.setPlace(undefined);
      setPlaced({ state: 'none' });
      redraw();
      return;
    }
    setPlaced({ state: 'reading' });
    data
      .place(place.map, place.x, place.y, (place.facing * Math.PI) / 180, PLACE_REACH)
      .then((scene) => {
        if (id !== placeRequest.current || !renderer.current) return;
        renderer.current.setPlace(scene);
        const problems = [...scene.problems, ...renderer.current.placeProblems];
        setPlaced({ state: 'shown', problem: problems.length > 0 ? problems.join('. ') : undefined });
        redraw();
      })
      .catch((cause) => {
        if (id !== placeRequest.current) return;
        renderer.current?.setPlace(undefined);
        setPlaced({ state: 'none', problem: `The place could not be read: ${messageOf(cause)}` });
        redraw();
      });
  }, [data, place?.map, place?.x, place?.y, place?.facing, shown === undefined]);
  useEffect(() => {
    renderer.current?.setFocus(place?.blur ?? 0.5);
    redraw();
  }, [place?.blur]);
  /** The picture is filled edge to edge: by a backdrop, or by a place. */
  const inPlace = placed.state === 'shown';

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
    setPlaying(false);
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
  // Playing: the animation on screen runs in a loop from where it is, with the camera held
  // on the animation's first moment so the view does not breathe with the pose.
  const playingSequence = playing ? pose?.sequence : undefined;
  useEffect(() => {
    const view = renderer.current;
    const duration = pose?.duration ?? 0;
    if (playingSequence === undefined || !view || duration <= 0) return;
    let stopped = false;
    let busy = false;
    let frame = 0;
    let shownAt = 0;
    let last: number | undefined;
    const offset = pose?.time ?? 0;
    const start = performance.now();
    const tick = async () => {
      if (stopped) return;
      frame = requestAnimationFrame(() => void tick());
      if (busy) return;
      busy = true;
      try {
        const now = performance.now();
        const result = await data.pose(playingSequence, (offset + now - start) % duration);
        if (stopped) return;
        view.setPose(result);
        redraw();
        last = result.pose.time;
        // The slider follows a few times a second; redrawing the whole panel every frame would cost frames.
        if (now - shownAt > 100) {
          shownAt = now;
          setPose((current) => current && { ...current, time: result.pose.time });
        }
      } catch (cause) {
        setError(messageOf(cause));
        setPlaying(false);
      } finally {
        busy = false;
      }
    };
    void data
      .pose(playingSequence, 0)
      .then((first) => {
        if (stopped) return;
        view.holdFraming(first.bounds);
        void tick();
      })
      .catch((cause) => {
        setError(messageOf(cause));
        setPlaying(false);
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      view.holdFraming(undefined);
      redraw();
      // The slider ends on the moment the picture stopped at.
      const time = last;
      if (time !== undefined) setPose((current) => (current?.sequence === playingSequence ? { ...current, time } : current));
    };
  }, [playingSequence, data, shown?.drawn]);

  /** The picture as PNG bytes, at the chosen size. With a backdrop the whole preview is saved, uncropped. */
  const picture = async () => {
    const view = renderer.current!;
    // The preview's backdrop is small; the picture gets one composed at its own size.
    if (hasBackdrop) view.setBackdrop(composeAt(size.width, size.height));
    try {
      const image = view.renderImage(camera.current, {
        longSide: Math.max(size.width, size.height),
        aspect: size.tight && !hasBackdrop ? preview.width / preview.height : size.width / size.height,
        tight: size.tight && !hasBackdrop && !inPlace,
      });
      unpremultiply(image.pixels);
      return { image, png: await encodePng(image) };
    } finally {
      if (hasBackdrop) view.setBackdrop(backdropSource.current);
    }
  };

  const save = async (how: 'download' | 'copy') => {
    if (!renderer.current || !race || !character) return;
    setExporting(true);
    try {
      const start = performance.now();
      const { image, png } = await picture();
      if (how === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as BlobPart], { type: 'image/png' }) })]);
      } else {
        downloadPng(png, `mogshot-${slug(`${race.name} ${SEX_NAMES[character.sex]}`)}.png`);
      }
      setExportNote({ bad: false, text: savedNote(how === 'copy' ? 'Copied' : 'Saved', image, png, start) });
    } catch (cause) {
      setExportNote({ bad: true, text: `The picture could not be ${how === 'copy' ? 'copied' : 'exported'}: ${messageOf(cause)}` });
    } finally {
      setExporting(false);
    }
  };

  /** Save the animation on screen as a clip: one pass of it, which loops without a seam. */
  const saveClip = async () => {
    const view = renderer.current;
    if (!view || !race || !character || !pose || pose.duration <= 0) return;
    setPlaying(false);
    setExporting(true);
    const start = performance.now();
    const { sequence, time } = pose;
    const fps = clipFormat === 'gif' ? GIF_FPS : CLIP_FPS;
    const { width, height } = clipSize(size.tight ? preview : size, clipFormat === 'gif');
    const times = clipTimes(pose.duration, fps);
    try {
      if (hasBackdrop) view.setBackdrop(composeAt(width, height));
      view.holdFraming((await data.pose(sequence, 0)).bounds);
      const bytes = await encodeClip({
        format: clipFormat,
        width,
        height,
        fps,
        frames: times.length,
        frame: async (i) => {
          view.setPose(await data.pose(sequence, times[i]!));
          return view.renderImage(camera.current, { longSide: Math.max(width, height), aspect: width / height, tight: false });
        },
        onProgress: (done, of) => setExportNote({ bad: false, text: `Drawing frame ${done} of ${of}…` }),
      });
      const { extension, type } = CLIP_FORMATS[clipFormat];
      downloadFile(bytes, `mogshot-${slug(`${race.name} ${SEX_NAMES[character.sex]} ${animation?.name ?? ''}`)}.${extension}`, type);
      setExportNote({
        bad: false,
        text:
          `Saved ${times.length} frames, ${(pose.duration / 1000).toFixed(1)} s at ${fps} a second, ${width} × ${height} ` +
          `(${(bytes.length / 1024 / 1024).toFixed(1)} MB) in ${((performance.now() - start) / 1000).toFixed(1)} s.` +
          (clipFormat !== 'frames' && !hasBackdrop && !inPlace ? ' With no backdrop the background is black; PNG frames keep it transparent.' : ''),
      });
    } catch (cause) {
      setExportNote({ bad: true, text: `The clip could not be exported: ${messageOf(cause)}` });
    } finally {
      // Back to what was on screen.
      view.holdFraming(undefined);
      if (hasBackdrop) view.setBackdrop(backdropSource.current);
      try {
        view.setPose(await data.pose(sequence, time));
      } catch {
        // The export's own error has been shown.
      }
      redraw();
      setExporting(false);
    }
  };

  /** Save the backdrop by itself, at the picture's size, to layer under a transparent character. */
  const saveBackdrop = async () => {
    setExporting(true);
    try {
      const start = performance.now();
      const canvas = composeAt(size.width, size.height);
      if (!canvas) return;
      const image = backdropImage(canvas);
      const png = await encodePng(image);
      downloadPng(png, `mogshot-backdrop-${backdropName(backdrop, screens)}.png`);
      setExportNote({ bad: false, text: savedNote('Saved the backdrop alone,', image, png, start) });
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
                data-backdrop={hasBackdrop ? backdropName(backdrop, screens) : ''}
                data-place={placed.state}
              />
            </div>
            <p class="dim small hint">
              Drag to turn, shift-drag to slide, scroll to zoom.{' '}
              {inPlace ? 'The place is part of the picture.' : hasBackdrop ? 'The backdrop is part of the picture.' : 'The grey squares are transparency.'}
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
                <button
                  class={playing ? 'plain on' : 'plain'}
                  id="play"
                  aria-pressed={playing}
                  disabled={!animation || exporting}
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? 'Pause' : 'Play'}
                </button>
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

            <PlaceControls place={place} onChange={setPlace} busy={placed.state === 'reading'} problem={placed.problem} />

            {active && (
              <BackdropControls backdrop={backdrop} onChange={onBackdrop} screens={screens} problem={screenProblem(backdrop, screen, screens)} />
            )}

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
            <div class="actions">
              <select
                id="clip-format"
                aria-label="Clip format"
                value={clipFormat}
                onChange={(event) => setClipFormat(event.currentTarget.value as ClipFormat)}
              >
                {(Object.keys(CLIP_FORMATS) as ClipFormat[]).map((format) => (
                  <option value={format}>{CLIP_FORMATS[format].name}</option>
                ))}
              </select>
              <button class="plain" id="download-clip" disabled={exporting || !shown || !animation} onClick={saveClip}>
                Download clip
              </button>
              <span class="dim small">
                {animation ? `${animation.name}, ${((pose?.duration ?? 0) / 1000).toFixed(1)} s, looping` : ''}
              </span>
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
