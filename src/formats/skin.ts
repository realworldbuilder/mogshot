/*
 * Reader for .skin files: one view of an M2 model. A skin lists which of the model's
 * vertices it uses, the triangles over them, the sections ("geosets") the triangles are
 * grouped into, and the batches that say how each section is drawn. Layout follows
 * wowdev.wiki and wow.export's Skin (MIT, Kruithne).
 */

export interface SkinSection {
  /** Geoset ID: group * 100 + variant (e.g. 401 = gloves, variant 1). 0 is part of the body. */
  id: number;
  vertexStart: number;
  vertexCount: number;
  /** First index into the skin's triangle index list. */
  indexStart: number;
  indexCount: number;
}

export interface SkinBatch {
  flags: number;
  priority: number;
  shaderId: number;
  sectionIndex: number;
  colorIndex: number;
  materialIndex: number;
  materialLayer: number;
  textureCount: number;
  textureComboIndex: number;
  textureCoordComboIndex: number;
  textureWeightComboIndex: number;
  textureTransformComboIndex: number;
}

export interface Skin {
  /** Position in the model's vertex list of each vertex this skin uses. */
  vertexLookup: Uint16Array;
  /** Triangle corners, as indices into `vertexLookup`. */
  indices: Uint16Array;
  sections: SkinSection[];
  batches: SkinBatch[];
}

const SKIN = 0x4e494b53;

export function parseSkin(bytes: Uint8Array): Skin {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== SKIN) throw new Error('Not a skin file');
  const array = (at: number) => ({ count: dv.getUint32(at, true), offset: dv.getUint32(at + 4, true) });
  const u16s = (a: { count: number; offset: number }) => new Uint16Array(bytes.slice(a.offset, a.offset + a.count * 2).buffer);

  const sectionArray = array(28);
  const sections: SkinSection[] = [];
  for (let i = 0; i < sectionArray.count; i++) {
    const at = sectionArray.offset + i * 48;
    // `level` carries the high 16 bits of the index start, which outgrew its field.
    const level = dv.getUint16(at + 2, true);
    sections.push({
      id: dv.getUint16(at, true),
      vertexStart: dv.getUint16(at + 4, true),
      vertexCount: dv.getUint16(at + 6, true),
      indexStart: dv.getUint16(at + 8, true) + (level << 16),
      indexCount: dv.getUint16(at + 10, true),
    });
  }

  const batchArray = array(36);
  const batches: SkinBatch[] = [];
  for (let i = 0; i < batchArray.count; i++) {
    const at = batchArray.offset + i * 24;
    batches.push({
      flags: dv.getUint8(at),
      priority: dv.getInt8(at + 1),
      shaderId: dv.getUint16(at + 2, true),
      sectionIndex: dv.getUint16(at + 4, true),
      colorIndex: dv.getInt16(at + 8, true),
      materialIndex: dv.getUint16(at + 10, true),
      materialLayer: dv.getUint16(at + 12, true),
      textureCount: dv.getUint16(at + 14, true),
      textureComboIndex: dv.getUint16(at + 16, true),
      textureCoordComboIndex: dv.getUint16(at + 18, true),
      textureWeightComboIndex: dv.getUint16(at + 20, true),
      textureTransformComboIndex: dv.getUint16(at + 22, true),
    });
  }

  return { vertexLookup: u16s(array(4)), indices: u16s(array(12)), sections, batches };
}
