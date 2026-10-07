import type { ComponentChildren } from 'preact';

export type DrawerName = 'look' | 'gear' | 'pose' | 'scene' | 'export';

export const DRAWERS: { id: DrawerName; name: string }[] = [
  { id: 'look', name: 'Look' },
  { id: 'gear', name: 'Gear' },
  { id: 'pose', name: 'Pose' },
  { id: 'scene', name: 'Scene' },
  { id: 'export', name: 'Export' },
];

interface Props {
  open: DrawerName | undefined;
  onClose: () => void;
  /** Every panel stays mounted, so what is typed in one is kept while another is shown. */
  panels: Record<DrawerName, ComponentChildren>;
}

/** The side panel the bar at the bottom opens, over the right of the screen. */
export function Drawer({ open, onClose, panels }: Props) {
  return (
    <aside id="drawer" class="drawer" hidden={!open} aria-label={DRAWERS.find((d) => d.id === open)?.name}>
      <div class="drawer-head">
        <span class="column-title">{DRAWERS.find((d) => d.id === open)?.name}</span>
        <button type="button" class="plain" id="close-drawer" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {DRAWERS.map((d) => (
        <section key={d.id} id={`drawer-${d.id}`} class="controls" hidden={open !== d.id}>
          {panels[d.id]}
        </section>
      ))}
    </aside>
  );
}
