/** One row of `.build.info`: an installed product sharing this Data folder. */
export interface BuildInfoEntry {
  product: string;
  active: boolean;
  /** Hex name of the build config under Data/config. */
  buildKey: string;
  cdnKey: string;
  /** e.g. "1.60.1.70170" */
  version: string;
  branch: string;
  tags: string;
}

/**
 * `.build.info` is a pipe-separated table. The header row names each column as
 * `Name!TYPE:size`; columns vary between Battle.net versions, so look them up by name.
 */
export function parseBuildInfo(text: string): BuildInfoEntry[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0];
  if (header === undefined) return [];
  const columns = header.split('|').map((column) => column.split('!')[0] ?? '');
  const entries: BuildInfoEntry[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('|');
    const get = (name: string) => cells[columns.indexOf(name)] ?? '';
    const buildKey = get('Build Key');
    if (buildKey === '') continue;
    entries.push({
      product: get('Product'),
      active: get('Active') === '1',
      buildKey,
      cdnKey: get('CDN Key'),
      version: get('Version'),
      branch: get('Branch'),
      tags: get('Tags'),
    });
  }
  return entries;
}
