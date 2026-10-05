import { hasTitle, NO_TITLE, type Title } from '../render/title';

const TITLE_KEY = 'mogshot.title';

export function recallTitle(): Title {
  try {
    const text = localStorage.getItem(TITLE_KEY);
    const kept = text ? (JSON.parse(text) as Partial<Title>) : undefined;
    if (!kept || typeof kept.text !== 'string') return NO_TITLE;
    return { text: kept.text, sub: typeof kept.sub === 'string' ? kept.sub : undefined, at: kept.at === 'bottom' ? 'bottom' : 'top' };
  } catch {
    return NO_TITLE;
  }
}

export function rememberTitle(title: Title): void {
  try {
    if (hasTitle(title)) localStorage.setItem(TITLE_KEY, JSON.stringify(title));
    else localStorage.removeItem(TITLE_KEY);
  } catch {
    // Private windows and full storage: the title is simply not remembered.
  }
}

interface TitleControlsProps {
  title: Title;
  onChange: (title: Title) => void;
  /** The PNG will be a tight crop, which leaves the title off. */
  cropped: boolean;
}

/** Words to lay over the picture and the clip. */
export function TitleControls({ title, onChange, cropped }: TitleControlsProps) {
  return (
    <div class="pose" id="title">
      <div class="scrub">
        <label class="small" for="title-text">
          Title
        </label>
        <input
          id="title-text"
          type="text"
          placeholder="words over the picture"
          value={title.text}
          onInput={(event) => onChange({ ...title, text: event.currentTarget.value })}
        />
        <input
          id="title-sub"
          type="text"
          aria-label="Second line"
          placeholder="a smaller second line"
          value={title.sub ?? ''}
          onInput={(event) => onChange({ ...title, sub: event.currentTarget.value })}
        />
        <select
          id="title-at"
          aria-label="Where the title sits"
          value={title.at}
          onChange={(event) => onChange({ ...title, at: event.currentTarget.value === 'bottom' ? 'bottom' : 'top' })}
        >
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
        </select>
      </div>
      {hasTitle(title) && cropped && (
        <p class="dim small" id="title-note">
          The tight crop has no room for a title: the PNG is saved without it. A clip keeps it, and so does any other size.
        </p>
      )}
    </div>
  );
}
