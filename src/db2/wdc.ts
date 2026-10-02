import type { DbdField } from './dbd';

/*
 * Reader for WDC5 database tables (.db2). The layout follows wowdev.wiki and wow.export's
 * WDCReader (MIT, Kruithne and Marlamin).
 *
 * A table is a header, per-field storage descriptions, shared pallet and common-value data,
 * then one or more sections of records. A section can be encrypted with a key that is not
 * public; such a section is skipped and reported, never treated as a failure.
 */

export type Value = number | bigint | string | number[] | bigint[] | string[];
export type Row = Record<string, Value>;

/** A section that could not be read because its encryption key is not known. */
export interface SkippedSection {
  /** Key name as listed in wowdev/TACTKeys. */
  keyName: string;
  rowCount: number;
  /** IDs of the rows in the section, when the file lists them. */
  ids: number[];
}

export interface Table {
  rows: Row[];
  /** Name of the ID column in each row. */
  idColumn: string;
  skipped: SkippedSection[];
}

export interface ReadOptions {
  /** Columns to read. All columns if omitted. The ID column is always read. */
  columns?: readonly string[];
  /** Byte ranges of the file that are zero because they could not be decrypted. */
  encrypted?: readonly { offset: number; length: number }[];
}

export interface TableHeader {
  recordCount: number;
  recordSize: number;
  tableHash: string;
  layoutHash: string;
  flags: number;
  idIndex: number;
  sectionCount: number;
}

const WDC5 = 0x35434457;
const HEADER_SIZE = 204;
const FLAG_SPARSE = 0x1;

const enum Storage {
  None = 0,
  Bitpacked = 1,
  CommonData = 2,
  Pallet = 3,
  PalletArray = 4,
  BitpackedSigned = 5,
}

const hex32 = (value: number) => value.toString(16).padStart(8, '0').toUpperCase();

export function readHeader(bytes: Uint8Array): TableHeader {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < HEADER_SIZE || dv.getUint32(0, true) !== WDC5) {
    const magic = String.fromCharCode(...bytes.subarray(0, 4)).replace(/[^\x20-\x7e]/g, '?');
    throw new Error(`Unsupported table format ${magic}; Mogshot reads WDC5`);
  }
  return {
    recordCount: dv.getUint32(136, true),
    recordSize: dv.getUint32(144, true),
    tableHash: hex32(dv.getUint32(152, true)),
    layoutHash: hex32(dv.getUint32(156, true)),
    flags: dv.getUint16(172, true),
    idIndex: dv.getUint16(174, true),
    sectionCount: dv.getUint32(200, true),
  };
}

interface Section {
  keyName: string | undefined;
  fileOffset: number;
  recordCount: number;
  stringTableSize: number;
  offsetRecordsEnd: number;
  idListSize: number;
  relationshipDataSize: number;
  offsetMapIdCount: number;
  copyTableCount: number;
  encryptedIds: number[];
}

interface FieldStorage {
  offsetBits: number;
  sizeBits: number;
  additionalDataSize: number;
  storage: number;
  packing: [number, number, number];
  /** Start of this field's pallet or common data in the file. */
  dataStart: number;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
const utf8 = new TextDecoder();

/** Reinterpret a stored 32-bit word as the field's declared type. Its high bits can be garbage. */
function cast(word: number, field: DbdField): number | bigint {
  if (field.type === 'float') {
    u32[0] = word;
    return f32[0]!;
  }
  const bits = field.bits ?? 32;
  if (bits === 64) return BigInt(word >>> 0);
  if (bits >= 32) return field.unsigned ? word >>> 0 : word | 0;
  const value = word & ((1 << bits) - 1);
  return !field.unsigned && value & (1 << (bits - 1)) ? value - (1 << bits) : value;
}

export function readTable(bytes: Uint8Array, fields: readonly DbdField[], options: ReadOptions = {}): Table {
  const header = readHeader(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const totalFieldCount = dv.getUint32(176, true);
  const fieldStorageInfoSize = dv.getUint32(188, true);
  const commonDataSize = dv.getUint32(192, true);
  const palletDataSize = dv.getUint32(196, true);
  const sparse = (header.flags & FLAG_SPARSE) !== 0;

  let p = HEADER_SIZE;
  const sections: Section[] = [];
  for (let i = 0; i < header.sectionCount; i++, p += 40) {
    const keyHash = dv.getBigUint64(p, true);
    sections.push({
      keyName: keyHash === 0n ? undefined : keyHash.toString(16).padStart(16, '0').toUpperCase(),
      fileOffset: dv.getUint32(p + 8, true),
      recordCount: dv.getUint32(p + 12, true),
      stringTableSize: dv.getUint32(p + 16, true),
      offsetRecordsEnd: dv.getUint32(p + 20, true),
      idListSize: dv.getUint32(p + 24, true),
      relationshipDataSize: dv.getUint32(p + 28, true),
      offsetMapIdCount: dv.getUint32(p + 32, true),
      copyTableCount: dv.getUint32(p + 36, true),
      encryptedIds: [],
    });
  }
  p += totalFieldCount * 4; // field_structure: superseded by the storage info below

  const storages: FieldStorage[] = [];
  for (let i = 0; i < fieldStorageInfoSize / 24; i++, p += 24) {
    storages.push({
      offsetBits: dv.getUint16(p, true),
      sizeBits: dv.getUint16(p + 2, true),
      additionalDataSize: dv.getUint32(p + 4, true),
      storage: dv.getUint32(p + 8, true),
      packing: [dv.getUint32(p + 12, true), dv.getUint32(p + 16, true), dv.getUint32(p + 20, true)],
      dataStart: 0,
    });
  }
  let palletAt = p;
  for (const storage of storages) {
    if (storage.storage === Storage.Pallet || storage.storage === Storage.PalletArray) {
      storage.dataStart = palletAt;
      palletAt += storage.additionalDataSize;
    }
  }
  p += palletDataSize;
  const commonValues = new Map<FieldStorage, Map<number, number>>();
  let commonAt = p;
  for (const storage of storages) {
    if (storage.storage !== Storage.CommonData) continue;
    const values = new Map<number, number>();
    for (let i = 0; i < storage.additionalDataSize / 8; i++) {
      values.set(dv.getUint32(commonAt + i * 8, true), dv.getUint32(commonAt + i * 8 + 4, true));
    }
    commonValues.set(storage, values);
    commonAt += storage.additionalDataSize;
  }
  p += commonDataSize;

  // WDC4+: each encrypted section lists the IDs of its rows, so they are known even when unreadable.
  const firstSectionOffset = sections[0]?.fileOffset ?? p;
  {
    let at = p;
    const lists: number[][] = [];
    for (const section of sections) {
      if (section.keyName === undefined || at + 4 > firstSectionOffset) continue;
      const count = dv.getUint32(at, true);
      const ids: number[] = [];
      for (let i = 0; i < count && at + 8 + i * 4 <= firstSectionOffset; i++) ids.push(dv.getUint32(at + 4 + i * 4, true));
      at += 4 + count * 4;
      lists.push(ids);
    }
    if (at === firstSectionOffset) {
      let n = 0;
      for (const section of sections) if (section.keyName !== undefined) section.encryptedIds = lists[n++] ?? [];
    }
  }

  // Match definition fields to stored fields.
  const inlineFields = fields.filter((field) => !field.nonInline);
  if (inlineFields.length !== storages.length) {
    throw new Error(
      `Table definition does not match the file: ${inlineFields.length} fields defined, ${storages.length} stored`,
    );
  }
  const idField = fields.find((field) => field.isId);
  if (!idField) throw new Error('Table definition has no ID field');
  const idColumn = idField.name;
  if (options.columns) {
    for (const name of options.columns) {
      if (!fields.some((field) => field.name === name)) throw new Error(`Table has no column ${name}`);
    }
  }
  const wanted = (field: DbdField) => !options.columns || field === idField || options.columns.includes(field.name);
  const relationField = fields.find((field) => field.isRelation && field.nonInline);
  const idStorage = idField.nonInline ? undefined : storages[inlineFields.indexOf(idField)];

  // Non-sparse string offsets resolve against a virtual layout: every section's records, then
  // every section's strings. Encrypted sections keep their place in it.
  const totalRecordBytes = header.recordCount * header.recordSize;
  const stringBlocks: { virtualStart: number; fileStart: number; size: number }[] = [];
  {
    let virtual = 0;
    for (const section of sections) {
      stringBlocks.push({
        virtualStart: virtual,
        fileStart: section.fileOffset + section.recordCount * header.recordSize,
        size: section.stringTableSize,
      });
      virtual += section.stringTableSize;
    }
  }
  const stringAt = (fileOffset: number): string => {
    let end = fileOffset;
    while (end < bytes.length && bytes[end] !== 0) end++;
    return utf8.decode(bytes.subarray(fileOffset, end));
  };
  const virtualString = (index: number): string => {
    for (const block of stringBlocks) {
      const local = index - block.virtualStart;
      if (local >= 0 && local < block.size) return stringAt(block.fileStart + local);
    }
    return '';
  };

  const bitsAt = (recordStart: number, offsetBits: number, sizeBits: number): number => {
    const byte = recordStart + (offsetBits >> 3);
    const shift = offsetBits & 7;
    if (sizeBits > 32) throw new Error('Bit-packed fields wider than 32 bits are not supported');
    let low = 0;
    for (let k = 0; k < 4 && byte + k < bytes.length; k++) low |= bytes[byte + k]! << (8 * k);
    let value = low >>> shift;
    if (shift + sizeBits > 32) value |= (bytes[byte + 4] ?? 0) << (32 - shift);
    return sizeBits === 32 ? value >>> 0 : (value & ((1 << sizeBits) - 1)) >>> 0;
  };

  /** One stored int/float element at a byte position. */
  const plainAt = (at: number, bits: number, field: DbdField): number | bigint => {
    if (field.type === 'float') return dv.getFloat32(at, true);
    switch (bits) {
      case 8:
        return field.unsigned ? dv.getUint8(at) : dv.getInt8(at);
      case 16:
        return field.unsigned ? dv.getUint16(at, true) : dv.getInt16(at, true);
      case 32:
        return field.unsigned ? dv.getUint32(at, true) : dv.getInt32(at, true);
      case 64:
        return field.unsigned ? dv.getBigUint64(at, true) : dv.getBigInt64(at, true);
      default:
        throw new Error(`Unsupported field width ${bits} for ${field.name}`);
    }
  };

  const isString = (field: DbdField) => field.type === 'string' || field.type === 'locstring';

  /** A field of a fixed-size record, addressed by its bit offset. */
  const readFixed = (
    field: DbdField,
    storage: FieldStorage,
    recordStart: number,
    virtualRecordStart: number,
    id: number,
  ): Value => {
    const count = field.arrayLength;
    switch (storage.storage) {
      case Storage.None: {
        const at = recordStart + (storage.offsetBits >> 3);
        const elementBits = storage.sizeBits / (count ?? 1);
        const one = (i: number): number | bigint | string => {
          const elementAt = at + (i * elementBits) / 8;
          if (!isString(field)) return plainAt(elementAt, elementBits, field);
          const offset = dv.getUint32(elementAt, true);
          if (offset === 0) return '';
          return virtualString(virtualRecordStart + (elementAt - recordStart) + offset - totalRecordBytes);
        };
        if (count === undefined) return one(0);
        return Array.from({ length: count }, (_, i) => one(i)) as Value;
      }
      case Storage.Bitpacked:
        return cast(bitsAt(recordStart, storage.offsetBits, storage.sizeBits), field);
      case Storage.BitpackedSigned: {
        const raw = bitsAt(recordStart, storage.offsetBits, storage.sizeBits);
        const shift = 32 - storage.sizeBits;
        return field.bits === 64 ? BigInt((raw << shift) >> shift) : (raw << shift) >> shift;
      }
      case Storage.CommonData:
        return cast(commonValues.get(storage)!.get(id) ?? storage.packing[0], field);
      case Storage.Pallet: {
        const index = bitsAt(recordStart, storage.offsetBits, storage.sizeBits);
        return cast(dv.getUint32(storage.dataStart + index * 4, true), field);
      }
      case Storage.PalletArray: {
        const index = bitsAt(recordStart, storage.offsetBits, storage.sizeBits);
        const length = storage.packing[2];
        return Array.from({ length }, (_, i) =>
          cast(dv.getUint32(storage.dataStart + (index * length + i) * 4, true), field),
        ) as Value;
      }
      default:
        throw new Error(`Unsupported field storage ${storage.storage} for ${field.name}`);
    }
  };

  const rows: Row[] = [];
  const byId = new Map<number, Row>();
  const skipped: SkippedSection[] = [];
  const copies: [destination: number, source: number][] = [];
  let virtualRecordStart = 0;

  for (const section of sections) {
    const sectionVirtualStart = virtualRecordStart;
    virtualRecordStart += section.recordCount * header.recordSize;

    const recordsEnd = sparse ? section.offsetRecordsEnd : section.fileOffset + section.recordCount * header.recordSize;
    const idListAt = sparse ? recordsEnd : recordsEnd + section.stringTableSize;
    const copyTableAt = idListAt + section.idListSize;
    const offsetMapAt = copyTableAt + section.copyTableCount * 8;
    const relationshipAt = offsetMapAt + section.offsetMapIdCount * 6;
    const offsetMapIdsAt = relationshipAt + section.relationshipDataSize;
    const sectionEnd = offsetMapIdsAt + section.offsetMapIdCount * 4;

    if (section.keyName !== undefined) {
      const undecrypted = options.encrypted?.some(
        (range) => range.offset < sectionEnd && range.offset + range.length > section.fileOffset,
      );
      let zeroed = true;
      for (let i = section.fileOffset; i < recordsEnd && zeroed; i++) zeroed = bytes[i] === 0;
      if (undecrypted || (zeroed && section.recordCount > 0)) {
        skipped.push({ keyName: section.keyName, rowCount: section.recordCount, ids: section.encryptedIds });
        continue;
      }
    }

    for (let i = 0; i < section.copyTableCount; i++) {
      const destination = dv.getUint32(copyTableAt + i * 8, true);
      const source = dv.getUint32(copyTableAt + i * 8 + 4, true);
      if (destination !== source) copies.push([destination, source]);
    }

    let relations: Map<number, number> | undefined;
    if (section.relationshipDataSize > 0) {
      relations = new Map();
      const count = dv.getUint32(relationshipAt, true);
      for (let i = 0; i < count; i++) {
        const at = relationshipAt + 12 + i * 8;
        relations.set(dv.getUint32(at + 4, true), dv.getUint32(at, true));
      }
    }

    const hasIdList = section.idListSize > 0;
    let idListAllZero = hasIdList;
    for (let i = 0; i < section.idListSize / 4 && idListAllZero; i++) {
      idListAllZero = dv.getUint32(idListAt + i * 4, true) === 0;
    }

    for (let index = 0; index < section.recordCount; index++) {
      const row: Row = {};
      let id: number | undefined;
      if (hasIdList) id = idListAllZero ? index : dv.getUint32(idListAt + index * 4, true);
      else if (sparse) id = dv.getUint32(offsetMapIdsAt + index * 4, true);

      if (sparse) {
        // Variable-size record with inline strings: fields are read in order.
        const start = dv.getUint32(offsetMapAt + index * 6, true);
        const size = dv.getUint16(offsetMapAt + index * 6 + 4, true);
        if (size === 0) continue;
        let at = start;
        for (let f = 0; f < inlineFields.length; f++) {
          const field = inlineFields[f]!;
          const storage = storages[f]!;
          if (storage.storage !== Storage.None) {
            throw new Error(`Unsupported field storage ${storage.storage} in a sparse table for ${field.name}`);
          }
          const count = field.arrayLength ?? 1;
          const elementBits = storage.sizeBits / count;
          const values: (number | bigint | string)[] = [];
          for (let i = 0; i < count; i++) {
            if (isString(field)) {
              let end = at;
              while (bytes[end] !== 0) end++;
              values.push(wanted(field) ? utf8.decode(bytes.subarray(at, end)) : '');
              at = end + 1;
            } else {
              values.push(plainAt(at, elementBits, field));
              at += elementBits / 8;
            }
          }
          if (field === idField && id === undefined) id = Number(values[0]);
          if (wanted(field)) row[field.name] = (field.arrayLength === undefined ? values[0]! : values) as Value;
        }
      } else {
        const recordStart = section.fileOffset + index * header.recordSize;
        const virtualStart = sectionVirtualStart + index * header.recordSize;
        // An inline ID is read first: common-data fields are looked up by it.
        if (id === undefined && idStorage) {
          id = Number(readFixed(idField, idStorage, recordStart, virtualStart, 0));
        }
        if (id === undefined) throw new Error('Table has neither an ID list nor an inline ID field');
        for (let f = 0; f < inlineFields.length; f++) {
          const field = inlineFields[f]!;
          if (wanted(field)) row[field.name] = readFixed(field, storages[f]!, recordStart, virtualStart, id);
        }
      }

      if (id === undefined) throw new Error('Table has neither an ID list nor an inline ID field');
      row[idColumn] = id;
      if (relationField && wanted(relationField)) row[relationField.name] = relations?.get(index) ?? 0;
      rows.push(row);
      byId.set(id, row);
    }
  }

  for (const [destination, source] of copies) {
    const original = byId.get(source);
    if (!original) continue;
    const copy: Row = { ...original, [idColumn]: destination };
    rows.push(copy);
    byId.set(destination, copy);
  }

  return { rows, idColumn, skipped };
}
