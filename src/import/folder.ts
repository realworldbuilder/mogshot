import { ADDON_FILE, type PickedFile } from '../io/file-list-source';
import { type ImportedRecord, mergeRecords, recordsFromSavedVariables } from './record';

/** The characters the Mogshot addon has captured, from every account's file in the picked folder. */
export async function recordsFromFolder(files: PickedFile[]): Promise<{ records: ImportedRecord[]; error?: string }> {
  const lists: ImportedRecord[][] = [];
  const errors: string[] = [];
  for (const { path, file } of files) {
    if (!ADDON_FILE.test(path)) continue;
    try {
      lists.push(recordsFromSavedVariables(await file.text()));
    } catch (cause) {
      errors.push(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return { records: mergeRecords(lists), error: errors.length > 0 ? errors.join('; ') : undefined };
}
