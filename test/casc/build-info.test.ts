import { describe, expect, it } from 'vitest';
import { parseBuildInfo } from '../../src/casc/build-info';
import { localeFromTags } from '../../src/casc/locale';

const SAMPLE = [
  'Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Install Key!HEX:16|IM Size!DEC:4|CDN Path!STRING:0|CDN Hosts!STRING:0|CDN Servers!STRING:0|Tags!STRING:0|Armadillo!STRING:0|Last Activated!STRING:0|Version!STRING:0|KeyRing!HEX:16|Product!STRING:0',
  'us|1|d3f2837397a016e380ea51c4e1e78d1d|7bfef39ed156aa00019d651013213326|||tpr/wow|a.example b.example|http://a.example/?maxhosts=8|OSX x86_64 US? acct-USA? geoip-US? enUS speech?:OSX x86_64 US? acct-USA? geoip-US? enUS text?|||1.60.1.70170||wow_classic_beta',
  'eu|0|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|||tpr/wow|a.example|http://a.example|Windows x86_64 EU? deDE speech?:Windows x86_64 EU? deDE text?|||12.0.1.60000||wow',
  '',
].join('\n');

describe('parseBuildInfo', () => {
  it('reads each product row by column name', () => {
    const entries = parseBuildInfo(SAMPLE);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      product: 'wow_classic_beta',
      active: true,
      buildKey: 'd3f2837397a016e380ea51c4e1e78d1d',
      cdnKey: '7bfef39ed156aa00019d651013213326',
      version: '1.60.1.70170',
      branch: 'us',
      tags: 'OSX x86_64 US? acct-USA? geoip-US? enUS speech?:OSX x86_64 US? acct-USA? geoip-US? enUS text?',
    });
    expect(entries[1]?.product).toBe('wow');
    expect(entries[1]?.active).toBe(false);
  });

  it('handles CRLF line endings and empty input', () => {
    expect(parseBuildInfo(SAMPLE.replace(/\n/g, '\r\n'))).toHaveLength(2);
    expect(parseBuildInfo('')).toEqual([]);
  });
});

describe('localeFromTags', () => {
  it('finds the text locale', () => {
    expect(localeFromTags('OSX x86_64 US? enUS speech?:OSX x86_64 US? deDE text?')).toBe('deDE');
    expect(localeFromTags('OSX x86_64 US? enUS speech?')).toBe('enUS');
    expect(localeFromTags('OSX x86_64')).toBeUndefined();
  });
});
