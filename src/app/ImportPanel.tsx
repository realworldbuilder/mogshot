import { useEffect, useRef, useState } from 'preact/hooks';
import { capturedAgo, decodeRecord, type ImportedRecord } from '../import/record';
import type { ImportResult } from '../import/resolve';
import type { DataClient } from '../worker/client';
import { messageOf } from './App';

interface Props {
  data: DataClient;
  /** The characters the addon captured, found in the folder. */
  records: ImportedRecord[];
  /** Why a captured file could not be read, if one could not. */
  recordsError?: string;
  /** The character on screen, if it was imported. */
  selectedKey?: string;
  onImport: (result: ImportResult, record: ImportedRecord) => void;
}

/** The class file names the addon reports, in words. */
const CLASS_NAMES: Record<string, string> = {
  WARRIOR: 'Warrior', PALADIN: 'Paladin', HUNTER: 'Hunter', ROGUE: 'Rogue', PRIEST: 'Priest', DEATHKNIGHT: 'Death Knight',
  SHAMAN: 'Shaman', MAGE: 'Mage', WARLOCK: 'Warlock', MONK: 'Monk', DRUID: 'Druid', DEMONHUNTER: 'Demon Hunter', EVOKER: 'Evoker',
};

function describe(record: ImportedRecord): string {
  const race = record.race.replace(/([a-z])([A-Z])/g, '$1 $2');
  const klass = record.className ? CLASS_NAMES[record.className] ?? record.className : '';
  return `${record.key} · ${race}${klass ? ` ${klass}` : ''}`;
}

/** Pick one of your own characters, or paste the code the addon shows. */
export function ImportPanel({ data, records, recordsError, selectedKey, onImport }: Props) {
  const [pasting, setPasting] = useState(false);
  const [code, setCode] = useState('');
  const [note, setNote] = useState<{ text: string; bad: boolean }>();
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const load = (record: ImportedRecord) => {
    const id = ++request.current;
    setBusy(true);
    data
      .resolveImport(record)
      .then((result) => {
        if (id !== request.current) return;
        onImport(result, record);
        const found = `${result.itemsFound.found} of ${result.itemsFound.of} items found`;
        const look =
          result.choicesApplied === undefined
            ? 'look not captured'
            : `${result.choicesApplied.applied} of ${result.choicesApplied.of} look choices apply`;
        const when = record.captured ? `captured ${capturedAgo(record.captured)}, ` : '';
        const text = `${record.name}: ${when}${found}, ${look}.`;
        setNote({ text: result.problems.length > 0 ? `${text} ${result.problems.join('. ')}.` : text, bad: result.problems.length > 0 });
      })
      .catch((cause) => {
        if (id === request.current) setNote({ text: messageOf(cause), bad: true });
      })
      .finally(() => {
        if (id === request.current) setBusy(false);
      });
  };

  // A pasted code is read as soon as it is whole.
  useEffect(() => {
    if (!pasting || code.trim() === '') return;
    const record = decodeRecord(code);
    if (!record) {
      setNote({ text: 'That is not a Mogshot code. It starts with MOG2; the addon shows it after /mogshot.', bad: true });
      return;
    }
    load(record);
  }, [code, pasting]);

  return (
    <div class="import" id="import">
      <div class="shortcuts">
        <select
          id="imported"
          aria-label="Your characters"
          // A pasted character is not in the list; the list then shows its first line.
          value={records.some((r) => r.key === selectedKey) ? selectedKey : ''}
          disabled={busy || records.length === 0}
          onChange={(event) => {
            const record = records.find((r) => r.key === event.currentTarget.value);
            if (record) load(record);
          }}
        >
          <option value="">{records.length === 0 ? 'No characters captured yet' : 'Choose a character…'}</option>
          {records.map((record) => (
            <option value={record.key}>{describe(record)}</option>
          ))}
        </select>
        <button class="plain" id="paste-toggle" aria-expanded={pasting} onClick={() => setPasting(!pasting)}>
          {pasting ? 'Hide' : 'Paste a code…'}
        </button>
      </div>
      {pasting && (
        <input
          id="import-code"
          type="text"
          placeholder="MOG2;…"
          aria-label="Mogshot code"
          value={code}
          ref={(input) => input?.focus()}
          onInput={(event) => setCode(event.currentTarget.value)}
        />
      )}
      {recordsError && <p class="bad small">A captured file could not be read: {recordsError}</p>}
      {note ? (
        <p class={`${note.bad ? 'bad' : 'dim'} small`} id="import-note">
          {note.text}
        </p>
      ) : (
        records.length === 0 && (
          <p class="dim small" id="import-note">
            To picture your own characters, install the Mogshot addon, log in to each one, type <code>/reload</code>, then
            drag the folder onto the page again. Or paste a code from <code>/mogshot</code>.
          </p>
        )
      )}
    </div>
  );
}
