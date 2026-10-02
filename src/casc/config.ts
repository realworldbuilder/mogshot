/**
 * Build and CDN config files are `key = value value ...` lines with `#` comments.
 * Returns each key's space-separated values.
 */
export function parseConfig(text: string): Map<string, string[]> {
  const config = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    config.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim().split(/\s+/));
  }
  return config;
}

/** Config files live at Data/config/ab/cd/abcd.... */
export function configPath(key: string): string {
  return `Data/config/${key.slice(0, 2)}/${key.slice(2, 4)}/${key}`;
}
