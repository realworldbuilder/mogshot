/** Root-file locale bits. */
export const LOCALE_FLAGS: Record<string, number> = {
  enUS: 0x2,
  koKR: 0x4,
  frFR: 0x10,
  deDE: 0x20,
  zhCN: 0x40,
  esES: 0x80,
  zhTW: 0x100,
  enGB: 0x200,
  esMX: 0x1000,
  ruRU: 0x2000,
  ptBR: 0x4000,
  itIT: 0x8000,
  ptPT: 0x10000,
};

/**
 * The installed text locale, from the `.build.info` Tags column
 * (e.g. "OSX x86_64 US? acct-USA? geoip-US? enUS speech?:... enUS text?").
 * Prefers the group tagged `text?`; falls back to any locale name present.
 */
export function localeFromTags(tags: string): string | undefined {
  const groups = tags.split(':');
  const ordered = [...groups.filter((g) => g.includes('text?')), ...groups];
  for (const group of ordered) {
    for (const word of group.split(' ')) {
      if (word in LOCALE_FLAGS) return word;
    }
  }
  return undefined;
}
