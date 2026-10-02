import type { ByteSource } from './byte-source';

/** A file from `<input type="file" webkitdirectory>` with its path inside the picked folder. */
export interface PickedFile {
  path: string;
  file: File;
}

/**
 * Paths inside the picked folder: `webkitRelativePath` starts with the folder's own name,
 * which is dropped. Only the files Mogshot reads are kept, so a folder with tens of
 * thousands of addon files stays cheap to hand to the worker.
 */
export function pickedFiles(files: Iterable<File>): PickedFile[] {
  const picked: PickedFile[] = [];
  for (const file of files) {
    const path = file.webkitRelativePath.split('/').slice(1).join('/');
    if (path === '.build.info' || /^data\/(data|config)\//i.test(path)) picked.push({ path, file });
  }
  return picked;
}

/** ByteSource over a file list. Lookups ignore case, as the game's folders are not case-sensitive. */
export class FileListSource implements ByteSource {
  private readonly files = new Map<string, File>();
  private readonly dirs = new Map<string, Set<string>>();

  constructor(picked: PickedFile[]) {
    for (const { path, file } of picked) {
      this.files.set(path.toLowerCase(), file);
      const parts = path.split('/');
      for (let i = 0; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/').toLowerCase();
        let names = this.dirs.get(dir);
        if (!names) this.dirs.set(dir, (names = new Set()));
        names.add(parts[i]!);
      }
    }
  }

  async list(dir: string): Promise<string[]> {
    return [...(this.dirs.get(dir.toLowerCase()) ?? [])];
  }

  async read(path: string, offset?: number, length?: number): Promise<Uint8Array> {
    const file = this.files.get(path.toLowerCase());
    if (!file) throw new Error(`File not found: ${path}`);
    const blob = offset === undefined || length === undefined ? file : file.slice(offset, offset + length);
    return new Uint8Array(await blob.arrayBuffer());
  }
}
