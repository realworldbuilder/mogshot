import type { ComponentChildren } from 'preact';
import type { Image } from '../formats/blp';
import { Pixels } from './Pixels';

interface Props {
  name: string;
  /** The game's picture; without one the ring shows `icon`, or the name's initials. */
  image?: Image;
  icon?: ComponentChildren;
  on: boolean;
  /** Shown but not to be picked: a class the race cannot be. */
  dim?: boolean;
  labelSide: 'right' | 'left' | 'below';
  onPick: () => void;
  /** An attribute that names the button for tests: `data-race`, `data-class`. */
  dataName?: string;
  dataValue?: string;
}

/** "Night Elf" -> "NE". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** A round picture in a metal ring with a name beside or under it, as the game's character creation screen has them. */
export function Portrait({ name, image, icon, on, dim, labelSide, onPick, dataName, dataValue }: Props) {
  const attrs = dataName ? { [dataName]: dataValue ?? name } : {};
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-disabled={dim || undefined}
      class={`portrait ${labelSide}${on ? ' on' : ''}${dim ? ' dim' : ''}`}
      onClick={() => !dim && onPick()}
      {...attrs}
    >
      <span class="ring">
        {image ? <Pixels image={image} /> : (icon ?? <span class="initials" aria-hidden="true" data-initials={initials(name)} />)}
      </span>
      <span class="portrait-name">{name}</span>
    </button>
  );
}
