import type { ComponentChildren } from 'preact';

interface Props {
  crestLeft: ComponentChildren;
  crestRight: ComponentChildren;
  top: ComponentChildren;
  left: ComponentChildren;
  centre: ComponentChildren;
  right: ComponentChildren;
  bottom: ComponentChildren;
  bar: ComponentChildren;
  drawer: ComponentChildren;
}

/** The character creation screen's frame: crests and the sex at the top, races down the sides, classes and the bar below. */
export function SelectScreen({ crestLeft, crestRight, top, left, centre, right, bottom, bar, drawer }: Props) {
  return (
    <div class="select" id="select">
      {/* The drawer lies over the body only: the bar below it stays in reach while a panel is open. */}
      <div class="select-body">
        <div class="select-crest-left">{crestLeft}</div>
        <div class="select-top">{top}</div>
        <div class="select-crest-right">{crestRight}</div>
        <div class="select-left">{left}</div>
        {centre}
        <div class="select-right">{right}</div>
        <div class="select-bottom">{bottom}</div>
        {drawer}
      </div>
      <div class="select-bar">{bar}</div>
    </div>
  );
}
