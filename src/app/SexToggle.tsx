import { Portrait } from './Portrait';

const SEX_NAMES = ['Male', 'Female'];

/** The ♂ and ♀ signs, drawn by the page. */
const GLYPHS = [
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="10" cy="14" r="6" fill="none" stroke="currentColor" stroke-width="2.4" />
    <path d="M14.5 9.5 L20 4 M20 4 h-5.5 M20 4 v5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
  </svg>,
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="2.4" />
    <path d="M12 15 v7 M8.5 19 h7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
  </svg>,
];

interface Props {
  /** The sexes the race on screen has a model for. */
  sexes: number[];
  sex: number;
  onPick: (sex: number) => void;
}

export function SexToggle({ sexes, sex, onPick }: Props) {
  return (
    <div class="sexes" id="sex" role="radiogroup" aria-label="Sex">
      {sexes.map((s) => (
        <Portrait key={s} name={SEX_NAMES[s] ?? String(s)} icon={GLYPHS[s]} on={s === sex} labelSide="below" onPick={() => onPick(s)} />
      ))}
    </div>
  );
}
