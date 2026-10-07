/** A faction's name with a shield beside it. The shield is the page's own, not the game's crest. */
export function Crest({ faction }: { faction: 'alliance' | 'horde' }) {
  return (
    <div class={`crest crest-${faction}`}>
      <svg viewBox="0 0 40 44" aria-hidden="true">
        <path d="M20 2 L37 8 V22 C37 33 29 40 20 43 C11 40 3 33 3 22 V8 Z" fill="var(--crest-fill)" stroke="var(--gold)" stroke-width="2" />
        {faction === 'alliance' ? (
          <path d="M20 10 L24 20 L20 34 L16 20 Z M11 23 L20 27 L29 23" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round" />
        ) : (
          <path d="M11 14 L20 24 L29 14 M20 24 V34 M14 30 L26 30" fill="none" stroke="var(--gold)" stroke-width="2.4" stroke-linecap="round" />
        )}
      </svg>
      <span>{faction === 'alliance' ? 'Alliance' : 'Horde'}</span>
    </div>
  );
}
