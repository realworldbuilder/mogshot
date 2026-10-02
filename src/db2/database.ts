import type { CascStorage } from '../casc/storage';
import { findLayout } from './dbd';
import type { Definitions } from './definitions';
import { readHeader, readTable, type Table } from './wdc';

/** A table could not be read at all. The message says which table and why. */
export class TableError extends Error {}

/** The game's database tables, read from the local archives and decoded with community definitions. */
export class Database {
  constructor(
    private readonly storage: CascStorage,
    private readonly definitions: Definitions,
  ) {}

  /** Read a table. `columns` limits which columns are decoded; the ID column is always included. */
  async table(name: string, columns?: readonly string[]): Promise<Table> {
    const fileId = await this.definitions.fileId(name);
    if (fileId === undefined) throw new TableError(`${name}: not listed in the table manifest`);
    const file = await this.storage.readFile(fileId);
    if (!file) throw new TableError(`${name}: file ${fileId} is not on disk`);

    const header = readHeader(file.data);
    const layout = findLayout(await this.definitions.dbd(name), header.layoutHash, this.storage.info.version);
    if (!layout) {
      throw new TableError(
        `${name}: no definition for layout ${header.layoutHash} (build ${this.storage.info.version})`,
      );
    }
    return readTable(file.data, layout.fields, { columns, encrypted: file.encrypted });
  }
}
