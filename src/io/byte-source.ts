/**
 * Read access to a WoW install folder. Paths are relative to that folder and
 * '/'-separated. The same data layer runs over a browser directory handle, a
 * browser file list, or Node's fs (tests).
 */
export interface ByteSource {
  /** Names of the entries directly inside `dir` ('' is the root). Empty if `dir` does not exist. */
  list(dir: string): Promise<string[]>;
  /** Bytes [offset, offset + length) of a file, or the whole file. Rejects if the file is missing. */
  read(path: string, offset?: number, length?: number): Promise<Uint8Array>;
}

export async function readText(source: ByteSource, path: string): Promise<string> {
  return new TextDecoder().decode(await source.read(path));
}
