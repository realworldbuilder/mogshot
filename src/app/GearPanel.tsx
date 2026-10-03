import { useEffect, useRef, useState } from 'preact/hooks';
import { type ClassInfo, type ItemSetInfo, type ItemSummary, type Slot, SLOTS } from '../character/equipment';
import type { DataClient } from '../worker/client';
import { messageOf } from './App';

/** The game's item quality colours, poor to heirloom. */
const QUALITY_COLORS = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80', '#00ccff'];

const icons = new Map<number, Promise<ImageData | undefined>>();

/** An item's icon, read from the game files the first time it is shown. */
function ItemIcon({ data, fileId }: { data: DataClient; fileId: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let current = true;
    if (!icons.has(fileId)) {
      icons.set(
        fileId,
        data
          .icon(fileId)
          .then((image) => image && new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height))
          .catch(() => undefined),
      );
    }
    void icons.get(fileId)!.then((image) => {
      const target = canvas.current;
      if (!current || !target) return;
      const context = target.getContext('2d')!;
      context.clearRect(0, 0, target.width, target.height);
      if (!image) return;
      target.width = image.width;
      target.height = image.height;
      context.putImageData(image, 0, 0);
    });
    return () => {
      current = false;
    };
  }, [data, fileId]);
  return <canvas class="icon" ref={canvas} width={64} height={64} />;
}

interface Props {
  data: DataClient;
  /** Race of the character, which decides the classes (and so the sets) on offer. */
  raceId: number;
  /** The character's class, or undefined until the race's classes are known. */
  classId: number | undefined;
  onClass: (classId: number) => void;
  gear: ReadonlyMap<Slot, ItemSummary>;
  onChange: (slot: Slot, item: ItemSummary | undefined) => void;
  /** Replace everything worn at once. */
  onOutfit: (outfit: [Slot, ItemSummary][]) => void;
}

const EPIC = 4;

/** One row per visible slot, with shortcuts above. Clicking a row opens a search of the items that fit it. */
export function GearPanel({ data, raceId, classId, onClass, gear, onChange, onOutfit }: Props) {
  const [open, setOpen] = useState<Slot>();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ items: ItemSummary[]; total: number }>();
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [sets, setSets] = useState<ItemSetInfo[]>([]);
  const chosenClass = useRef(classId);
  chosenClass.current = classId;

  // The classes this race can be, then the sets the chosen class can wear. A class the race
  // cannot be becomes the first it can.
  useEffect(() => {
    let current = true;
    data
      .classes(raceId)
      .then((list) => {
        if (!current) return;
        setClasses(list);
        const first = list[0];
        if (first && !list.some((c) => c.id === chosenClass.current)) onClass(first.id);
      })
      .catch((cause) => setError(messageOf(cause)));
    return () => {
      current = false;
    };
  }, [data, raceId]);
  useEffect(() => {
    if (classId === undefined) return;
    let current = true;
    data
      .sets(classId)
      .then((list) => current && setSets(list))
      .catch((cause) => setError(messageOf(cause)));
    return () => {
      current = false;
    };
  }, [data, classId]);

  const randomEpics = () => data.randomOutfit(EPIC).then(onOutfit).catch((cause) => setError(messageOf(cause)));

  // Search as the user types; a newer search supersedes an older one.
  useEffect(() => {
    if (!open) return;
    const id = ++request.current;
    const timer = setTimeout(() => {
      data
        .searchItems(open, query)
        .then((result) => {
          if (id !== request.current) return;
          setFound(result);
          setError(undefined);
        })
        .catch((cause) => {
          if (id === request.current) setError(messageOf(cause));
        });
    }, 120);
    return () => clearTimeout(timer);
  }, [data, open, query]);

  const toggle = (slot: Slot) => {
    setQuery('');
    setFound(undefined);
    setOpen(open === slot ? undefined : slot);
  };

  return (
    <div class="gear" id="gear">
      <div class="shortcuts">
        <button class="plain" id="random-epics" onClick={randomEpics}>
          Random epics
        </button>
        <button class="plain" id="clear-gear" onClick={() => onOutfit([])} disabled={gear.size === 0}>
          Clear
        </button>
      </div>
      <div class="shortcuts">
        <select id="class" aria-label="Class" value={classId} onChange={(event) => onClass(Number(event.currentTarget.value))}>
          {classes.map((c) => (
            <option value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          id="set"
          aria-label="Set"
          value=""
          disabled={sets.length === 0}
          onChange={(event) => {
            const set = sets.find((s) => s.id === Number(event.currentTarget.value));
            if (set) onOutfit(set.pieces);
          }}
        >
          <option value="">{sets.length === 0 ? 'No sets' : 'Equip a set…'}</option>
          {sets.map((set) => (
            <option value={set.id}>
              {set.name} ({set.pieces.length} pieces, level {set.level})
            </option>
          ))}
        </select>
        <button class="plain" id="best-set" disabled={sets.length === 0} onClick={() => sets[0] && onOutfit(sets[0].pieces)}>
          Best set
        </button>
      </div>
      {error && !open && <p class="bad small">{error}</p>}
      {SLOTS.map((slot) => {
        const item = gear.get(slot.id);
        return (
          <div class="slot" key={slot.id} data-slot={slot.id}>
            <div class="slot-row">
              <button class="slot-pick" onClick={() => toggle(slot.id)} aria-expanded={open === slot.id}>
                {item ? <ItemIcon data={data} fileId={item.iconFileId} /> : <span class="icon empty" />}
                <span class="slot-text">
                  <span class="slot-name">{slot.name}</span>
                  <span class="item-name" style={item ? { color: QUALITY_COLORS[item.quality] ?? '#fff' } : undefined}>
                    {item ? item.name : 'Empty'}
                  </span>
                </span>
              </button>
              {item && (
                <button class="slot-clear" title={`Remove ${item.name}`} onClick={() => onChange(slot.id, undefined)}>
                  ×
                </button>
              )}
            </div>
            {open === slot.id && (
              <div class="search">
                <input
                  type="search"
                  placeholder={`Search ${slot.name.toLowerCase()} items by name`}
                  value={query}
                  // Opening a slot is a request to type in it.
                  ref={(input) => input?.focus()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
                {error && <p class="bad small">{error}</p>}
                {found && (
                  <>
                    <ul class="results">
                      {found.items.map((result) => (
                        <li key={result.id}>
                          <button
                            onClick={() => {
                              onChange(slot.id, result);
                              setOpen(undefined);
                            }}
                          >
                            <ItemIcon data={data} fileId={result.iconFileId} />
                            <span style={{ color: QUALITY_COLORS[result.quality] ?? '#fff' }}>{result.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p class="dim small result-count">
                      {found.total === 0
                        ? 'No items match.'
                        : found.total > found.items.length
                          ? `Showing ${found.items.length} of ${found.total.toLocaleString()}. Type more to narrow it down.`
                          : `${found.total} ${found.total === 1 ? 'item' : 'items'}.`}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
