import { parseBuildInfo } from '../casc/build-info';
import { configPath } from '../casc/config';
import { InstallError, notInstallMessage } from '../casc/storage';
import type { PickedFile } from './file-list-source';

/*
 * A folder dragged onto the page, read through the older entries API
 * (`DataTransferItem.webkitGetAsEntry`). Unlike `showDirectoryPicker`, Chrome does not
 * refuse folders inside /Applications or Program Files this way, and nothing is listed
 * or read until asked for.
 */

function entriesOf(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    // readEntries returns the listing in batches; an empty batch ends it.
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

function child(dir: FileSystemDirectoryEntry, name: string, kind: 'file' | 'directory'): Promise<FileSystemEntry | undefined> {
  return new Promise((resolve) => {
    const get = kind === 'file' ? dir.getFile.bind(dir) : dir.getDirectory.bind(dir);
    get(name, {}, resolve, () => resolve(undefined));
  });
}

function fileOf(entry: FileSystemEntry): Promise<File> {
  return new Promise((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
}

/**
 * Collect the files Mogshot reads from a dropped WoW folder: `.build.info`, the build
 * configs it names, and everything directly inside Data/data.
 */
export async function filesFromDroppedFolder(root: FileSystemDirectoryEntry): Promise<PickedFile[]> {
  const buildInfo = await child(root, '.build.info', 'file');
  if (!buildInfo) {
    throw new InstallError(notInstallMessage((await entriesOf(root)).map((entry) => entry.name)));
  }
  const picked: PickedFile[] = [];
  const buildInfoFile = await fileOf(buildInfo);
  picked.push({ path: '.build.info', file: buildInfoFile });

  for (const product of parseBuildInfo(await buildInfoFile.text())) {
    const path = configPath(product.buildKey);
    const entry = await child(root, path, 'file');
    if (entry) picked.push({ path, file: await fileOf(entry) });
  }

  const data = await child(root, 'Data/data', 'directory');
  if (data) {
    for (const entry of await entriesOf(data as FileSystemDirectoryEntry)) {
      if (entry.isFile) picked.push({ path: `Data/data/${entry.name}`, file: await fileOf(entry) });
    }
  }
  return picked;
}
