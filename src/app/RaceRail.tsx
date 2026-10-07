import type { Faction, Race } from '../character/races';
import type { Portraits } from '../worker/api';
import { Portrait } from './Portrait';

const LABELS: Record<Faction, string> = { alliance: 'Alliance', horde: 'Horde', neutral: 'Neutral', unknown: 'Other' };
const SIDES: Record<Faction, 'right' | 'left' | 'below'> = { alliance: 'right', horde: 'left', neutral: 'below', unknown: 'below' };

interface Props {
  faction: Faction;
  races: Race[];
  raceId: number;
  /** The sex on screen: each race's picture is of that sex, or of its only one. */
  sex: number;
  portraits: Portraits | undefined;
  onPick: (race: Race) => void;
}

/** One faction's races, each a portrait with its name, down one side of the screen. */
export function RaceRail({ faction, races, raceId, sex, portraits, onPick }: Props) {
  return (
    <div class={`rail rail-${faction}`} role="radiogroup" aria-label={`${LABELS[faction]} races`}>
      {races.map((race) => {
        const shown = race.sexes.includes(sex) ? sex : (race.sexes[0] ?? 0);
        return (
          <div class="race-row" key={race.id}>
            <Portrait
              name={race.name}
              image={portraits?.races[`${race.key}:${shown}`]}
              on={race.id === raceId}
              labelSide={SIDES[faction]}
              onPick={() => onPick(race)}
              dataName="data-race"
            />
          </div>
        );
      })}
    </div>
  );
}
