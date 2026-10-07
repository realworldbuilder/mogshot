import type { ClassEntry } from '../character/races';
import type { Portraits } from '../worker/api';
import { Portrait } from './Portrait';

interface Props {
  classes: ClassEntry[];
  raceId: number;
  classId: number | undefined;
  portraits: Portraits | undefined;
  onPick: (classId: number) => void;
}

/** Every class along the bottom, in the game's order; the ones the race cannot be are dimmed. */
export function ClassBar({ classes, raceId, classId, portraits, onPick }: Props) {
  return (
    <div class="classes" id="class" role="radiogroup" aria-label="Class">
      {classes.map((c) => (
        <Portrait
          key={c.id}
          name={c.name}
          image={portraits?.classes[c.key]}
          on={c.id === classId}
          dim={!c.races.includes(raceId)}
          labelSide="below"
          onPick={() => onPick(c.id)}
          dataName="data-class"
        />
      ))}
    </div>
  );
}
