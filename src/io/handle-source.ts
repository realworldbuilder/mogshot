import type { ByteSource } from './byte-source';

/** ByteSource over a folder the user picked with `showDirectoryPicker`. */
export class HandleSource implements ByteSource {
  private readonly dirs = new Map<string, Promise<FileSystemDirectoryHandle | undefined>>();
  private readonly files = new Map<string, Promise<File>>();

  constructor(root: FileSystemDirectoryHandle) {
    this.dirs.set('', Promise.resolve(root));
  }

  private dir(path: string): Promise<FileSystemDirectoryHandle | undefined> {
    let found = this.dirs.get(path);
    if (!found) {
      const cut = path.lastIndexOf('/');
      const parent = this.dir(cut < 0 ? '' : path.slice(0, cut));
      found = parent.then(async (handle) => {
        try {
          return await handle?.getDirectoryHandle(path.slice(cut + 1));
        } catch (error) {
          if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) {
            return undefined;
          }
          throw error;
        }
      });
      this.dirs.set(path, found);
    }
    return found;
  }

  async list(dir: string): Promise<string[]> {
    const handle = await this.dir(dir);
    if (!handle) return [];
    const names: string[] = [];
    for await (const name of handle.keys()) names.push(name);
    return names;
  }

  private file(path: string): Promise<File> {
    let found = this.files.get(path);
    if (!found) {
      const cut = path.lastIndexOf('/');
      found = this.dir(cut < 0 ? '' : path.slice(0, cut)).then(async (handle) => {
        if (!handle) throw new Error(`File not found: ${path}`);
        return (await handle.getFileHandle(path.slice(cut + 1))).getFile();
      });
      this.files.set(path, found);
    }
    return found;
  }

  async read(path: string, offset?: number, length?: number): Promise<Uint8Array> {
    const file = await this.file(path);
    const blob = offset === undefined || length === undefined ? file : file.slice(offset, offset + length);
    return new Uint8Array(await blob.arrayBuffer());
  }
}
