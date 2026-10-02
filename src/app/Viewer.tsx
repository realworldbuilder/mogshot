import { useEffect, useRef, useState } from 'preact/hooks';
import type { Option } from '../character/appearance';
import type { ItemSummary, Slot } from '../character/equipment';
import { encodePng, unpremultiply } from '../render/export';
import { CharacterRenderer, DEFAULT_CAMERA } from '../render/renderer';
import type { Race } from '../worker/api';
import type { DataClient } from '../worker/client';
import { messageOf } from './App';
import { GearPanel } from './GearPanel';

/** Longer side of the exported picture, in pixels. */
const EXPORT_LONG_SIDE = 3840;
const SEX_NAMES = ['Male', 'Female'];

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
  ms: number;
}

export function Viewer({ data }: { data: DataClient }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<CharacterRenderer>(null);
  const request = useRef(0);

  const [races, setRaces] = useState<Race[]>();
  const [character, setCharacter] = useState<Character>();
  // What is worn stays on when the race or sex changes.
  const [gear, setGear] = useState<ReadonlyMap<Slot, ItemSummary>>(new Map());
  const [shown, setShown] = useState<Shown>();
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string>();
  const [tight, setTight] = useState(true);
  const [exportNote, setExportNote] = useState<{ text: string; bad: boolean }>();
  const [exporting, setExporting] = useState(false);

  // The races the game lets you create; start on a human male if there is one.
  useEffect(() => {
    data
      .races()
      .then((list) => {
        setRaces(list);
        const first = list.find((race) => race.name === 'Human') ?? list[0];
        if (first) setCharacter({ raceId: first.id, sex: first.sexes[0] ?? 0, choices: [] });
        else setError('The game data lists no races a player can create.');
      })
      .catch((cause) => setError(messageOf(cause)));
  }, [data]);

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
      )
      .then((built) => {
        if (id !== request.current || !canvas.current) return;
        renderer.current ??= new CharacterRenderer(canvas.current);
        renderer.current.setScene(built.scene);
        renderer.current.render();
        setShown({
          drawn: id,
          options: built.scene.options,
          choices: new Map(built.scene.choices),
          problems: [...built.scene.problems, ...renderer.current.problems],
          ms: built.ms,
        });
        setError(undefined);
      })
      .catch((cause) => {
        if (id === request.current) setError(messageOf(cause));
      })
      .finally(() => {
        if (id === request.current) setBuilding(false);
      });
  }, [data, character, gear]);

  const race = races?.find((r) => r.id === character?.raceId);

  const choose = (optionId: number, choiceId: number) => {
    if (!character || !shown) return;
    const choices = new Map(shown.choices);
    choices.set(optionId, choiceId);
    setCharacter({ ...character, choices: [...choices] });
  };

  const download = async () => {
    if (!renderer.current || !canvas.current || !race || !character) return;
    setExporting(true);
    try {
      const start = performance.now();
      const image = renderer.current.renderImage(DEFAULT_CAMERA, {
        longSide: EXPORT_LONG_SIDE,
        aspect: canvas.current.width / canvas.current.height,
        tight,
      });
      unpremultiply(image.pixels);
      const png = await encodePng(image);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }));
      const name = `${race.name} ${SEX_NAMES[character.sex]}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      link.download = `mogshot-${name}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      setExportNote({
        bad: false,
        text:
          `Saved ${image.width.toLocaleString()} × ${image.height.toLocaleString()} pixels ` +
          `(${(png.length / 1024 / 1024).toFixed(1)} MB) in ${((performance.now() - start) / 1000).toFixed(1)} s.`,
      });
    } catch (cause) {
      setExportNote({ bad: true, text: `The picture could not be exported: ${messageOf(cause)}` });
    } finally {
      setExporting(false);
    }
  };

  return (
    <section class="panel" id="character">
      {error && (
        <p class="bad" id="character-error">
          The character could not be drawn: {error}
        </p>
      )}
      {!races && !error && <p class="dim">Reading the game database…</p>}
      {races && character && (
        <div class="viewer">
          <div>
            <div class="stage">
              <canvas
                id="canvas"
                ref={canvas}
                width={960}
                height={1280}
                class={building ? 'building' : ''}
                data-drawn={shown?.drawn ?? 0}
              />
            </div>
            <div class="actions">
              <button class="primary" id="download" disabled={exporting || !shown} onClick={download}>
                Download PNG
              </button>
              <label class="small">
                <input type="checkbox" id="tight" checked={tight} onChange={(e) => setTight(e.currentTarget.checked)} /> Crop
                tightly to the character
              </label>
            </div>
            <p class={`${exportNote?.bad ? 'bad' : 'dim'} small`} id="export-note">
              {exportNote?.text ?? 'A transparent PNG, 3840 pixels on its longer side. The grey squares are transparency.'}
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
            <label class="field">
              <span>Race</span>
              <select
                id="race"
                value={character.raceId}
                onChange={(event) => {
                  const next = races.find((r) => r.id === Number(event.currentTarget.value))!;
                  const sex = next.sexes.includes(character.sex) ? character.sex : (next.sexes[0] ?? 0);
                  setCharacter({ raceId: next.id, sex, choices: [] });
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
                    onClick={() => setCharacter({ raceId: character.raceId, sex, choices: [] })}
                  >
                    {SEX_NAMES[sex]}
                  </button>
                ))}
              </div>
            </div>

            {shown?.options.filter((option) => !option.hidden).map((option) => {
              const current = shown.choices.get(option.id);
              // Choices only non-player characters or special classes can use are left out.
              const choices = option.choices.filter((choice) => choice.available || choice.id === current);
              let unnamed = 0;
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
              gear={gear}
              onChange={(slot, item) => {
                const next = new Map(gear);
                if (item) next.set(slot, item);
                else next.delete(slot);
                setGear(next);
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
