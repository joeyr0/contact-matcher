import { describe, it, expect } from 'vitest';
import { normalizeDomain, isGenericDomain, parseMultiDomain } from '../lib/normalize';

describe('normalizeDomain', () => {
  it('strips https:// and www.', () => {
    expect(normalizeDomain('https://www.example.com/')).toBe('example.com');
  });

  it('handles uppercase protocol and domain', () => {
    expect(normalizeDomain('HTTP://WWW.EXAMPLE.COM')).toBe('example.com');
  });

  it('strips www. without protocol', () => {
    expect(normalizeDomain('www.example.com')).toBe('example.com');
  });

  it('strips path segments', () => {
    expect(normalizeDomain('example.com/en')).toBe('example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeDomain('  example.com  ')).toBe('example.com');
  });

  it('handles klar.mx with trailing slash', () => {
    expect(normalizeDomain('https://www.klar.mx/')).toBe('klar.mx');
  });

  it('handles sarwa.co with path', () => {
    expect(normalizeDomain('https://www.sarwa.co/en')).toBe('sarwa.co');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeDomain('')).toBe('');
  });

  it('leaves plain domain unchanged', () => {
    expect(normalizeDomain('example.com')).toBe('example.com');
  });

  it('strips trailing dot', () => {
    expect(normalizeDomain('example.com.')).toBe('example.com');
  });

  it('strips http:// without www', () => {
    expect(normalizeDomain('http://example.com')).toBe('example.com');
  });

  it('strips https:// without www, with path', () => {
    expect(normalizeDomain('https://company.io/about/us')).toBe('company.io');
  });

  it('strips port number', () => {
    expect(normalizeDomain('example.com:8080')).toBe('example.com');
  });

  it('strips protocol and port', () => {
    expect(normalizeDomain('http://example.com:3000/path')).toBe('example.com');
  });
});

describe('isGenericDomain', () => {
  it('returns true for gmail.com', () => {
    expect(isGenericDomain('gmail.com')).toBe(true);
  });

  it('returns true for yahoo.com', () => {
    expect(isGenericDomain('yahoo.com')).toBe(true);
  });

  it('returns true for proton.me', () => {
    expect(isGenericDomain('proton.me')).toBe(true);
  });

  it('returns false for a company domain', () => {
    expect(isGenericDomain('turnkey.com')).toBe(false);
  });

  it('returns false for an unknown domain', () => {
    expect(isGenericDomain('somestartup.io')).toBe(false);
  });
});

describe('parseMultiDomain', () => {
  it('returns single domain in array', () => {
    expect(parseMultiDomain('example.com')).toEqual(['example.com']);
  });

  it('splits two comma-separated domains', () => {
    expect(parseMultiDomain('oplabs.co,optimism.io')).toEqual(['oplabs.co', 'optimism.io']);
  });

  it('splits three comma-separated domains', () => {
    expect(parseMultiDomain('skymavis.com,roninchain.com,axieinfinity.com')).toEqual([
      'skymavis.com',
      'roninchain.com',
      'axieinfinity.com',
    ]);
  });

  it('handles spaces around commas', () => {
    expect(parseMultiDomain('a.com , b.com , c.com')).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('normalizes each domain in the list', () => {
    expect(parseMultiDomain('https://www.foo.com/,http://bar.io/en')).toEqual([
      'foo.com',
      'bar.io',
    ]);
  });

  it('filters empty segments', () => {
    expect(parseMultiDomain('a.com,,b.com')).toEqual(['a.com', 'b.com']);
  });
});
