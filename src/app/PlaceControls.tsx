import { useState } from 'preact/hooks';

/** Where in the game world the character stands, as the page keeps it. */
export interface PlaceChoice {
  /** The game's number for the map: 0 Eastern Kingdoms, 1 Kalimdor. */
  map: number;
  x: number;
  y: number;
  /** Degrees anticlockwise from north. */
  facing: number;
  /** How strongly the distance is blurred, 0 to 1. */
  blur: number;
}

/** Spots that are known to work, for a first look without the addon. */
export const SPOTS: { name: string; spot: Omit<PlaceChoice, 'blur'> }[] = [
  { name: "Stormwind, the gate bridge", spot: { map: 0, x: -8833, y: 628, facing: 215 } },
  { name: 'Elwynn Forest, near Goldshire', spot: { map: 0, x: -9440, y: 40, facing: 135 } },
];

const PLACE_KEY = 'mogshot.place';

export function recallPlace(): PlaceChoice | undefined {
  try {
    const text = localStorage.getItem(PLACE_KEY);
    return text ? (JSON.parse(text) as PlaceChoice) : undefined;
  } catch {
    return undefined;
  }
}

export function rememberPlace(place: PlaceChoice | undefined): void {
  try {
    if (place) localStorage.setItem(PLACE_KEY, JSON.stringify(place));
    else localStorage.removeItem(PLACE_KEY);
  } catch {
    // Private windows and full storage: the place is simply not remembered.
  }
}

/** A spot from the line the addon prints for `/mogshot spot`: "spot <map> <x> <y> <facing>". The words around it do not matter. */
export function parseSpot(text: string): Omit<PlaceChoice, 'blur'> | undefined {
  const numbers = text.match(/-?\d+(\.\d+)?/g)?.map(Number);
  if (!numbers || numbers.length < 3) return undefined;
  const [map, x, y, facing = 0] = numbers as [number, number, number, number?];
  if (!Number.isInteger(map) || map < 0 || Math.abs(x) > 17100 || Math.abs(y) > 17100) return undefined;
  return { map, x, y, facing: ((facing % 360) + 360) % 360 };
}

interface PlaceControlsProps {
  place: PlaceChoice | undefined;
  onChange: (place: PlaceChoice | undefined) => void;
  /** The place is being read. */
  busy: boolean;
  problem?: string;
}

const same = (a: Omit<PlaceChoice, 'blur'>, b: Omit<PlaceChoice, 'blur'>) => a.map === b.map && a.x === b.x && a.y === b.y;

/** Choosing a place in the game world to stand the character in. */
export function PlaceControls({ place, onChange, busy, problem }: PlaceControlsProps) {
  const [pasted, setPasted] = useState('');
  const [bad, setBad] = useState(false);
  const known = place ? SPOTS.findIndex((s) => same(s.spot, place)) : -1;
  const blur = place?.blur ?? 0.5;
  return (
    <div class="pose" id="place">
      <div class="scrub">
        <label class="small" for="place-spot">
          Place
        </label>
        <select
          id="place-spot"
          value={!place ? 'none' : known >= 0 ? String(known) : 'own'}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === 'none') onChange(undefined);
            else if (SPOTS[Number(value)]) onChange({ ...SPOTS[Number(value)]!.spot, blur });
          }}
        >
          <option value="none">None</option>
          {SPOTS.map((s, i) => (
            <option value={i}>{s.name}</option>
          ))}
          {place && known < 0 && <option value="own">Your spot ({Math.round(place.x)}, {Math.round(place.y)})</option>}
        </select>
        <input
          id="place-paste"
          type="text"
          class={bad ? 'bad' : ''}
          placeholder="or paste a line from /mogshot spot"
          value={pasted}
          onInput={(event) => {
            const text = event.currentTarget.value;
            setPasted(text);
            const spot = parseSpot(text);
            setBad(text.trim() !== '' && !spot);
            if (spot) onChange({ ...spot, blur });
          }}
        />
      </div>
      {place && (
        <div class="scrub">
          <label class="small" for="place-facing">
            Facing
          </label>
          <input
            id="place-facing"
            type="range"
            min={0}
            max={359}
            step={1}
            value={place.facing}
            // The place is read again for a new facing, so only once the slider is let go.
            onChange={(event) => onChange({ ...place, facing: Number(event.currentTarget.value) })}
          />
          <label class="small" for="place-blur">
            Blur
          </label>
          <input
            id="place-blur"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={blur}
            onInput={(event) => onChange({ ...place, blur: Number(event.currentTarget.value) })}
          />
        </div>
      )}
      {(busy || problem) && (
        <p class={`${problem ? 'bad' : 'dim'} small`} id="place-note">
          {problem ?? 'Reading the place from the game files…'}
        </p>
      )}
    </div>
  );
}
