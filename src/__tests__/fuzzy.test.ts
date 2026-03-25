import { describe, it, expect } from 'vitest';
import { getNgramCandidates, parseFuzzyResponse } from '../lib/fuzzy';

// ---------------------------------------------------------------------------
// getNgramCandidates
// ---------------------------------------------------------------------------

describe('getNgramCandidates', () => {
  const refDomains = [
    'haiku.xyz',
    'avalabs.com',
    'avax.com',
    'completely-unrelated-domain.org',
    'matter-labs.io',
    'matterlabs.dev',
  ];

  it('includes domains with high bigram overlap', () => {
    const candidates = getNgramCandidates(['haiku.trade'], refDomains);
    expect(candidates).toContain('haiku.xyz');
  });

  it('includes candidates matching the base name', () => {
    const candidates = getNgramCandidates(['avax.network'], refDomains);
    expect(candidates).toContain('avax.com');
    expect(candidates).toContain('avalabs.com');
  });

  it('excludes clearly unrelated domains when similarity is too low', () => {
    const candidates = getNgramCandidates(['haiku.trade'], refDomains);
    expect(candidates).not.toContain('completely-unrelated-domain.org');
  });

  it('handles a batch of multiple unmatched domains (union)', () => {
    const candidates = getNgramCandidates(['haiku.trade', 'avax.network'], refDomains);
    expect(candidates).toContain('haiku.xyz');
    expect(candidates).toContain('avax.com');
  });

  it('filters out clearly unrelated domains from a large list', () => {
    // Build a ref list where only one domain has meaningful overlap
    const bigRefList = [
      'haiku.xyz',
      ...Array.from({ length: 50 }, (_, i) => `unrelated-corp-${i}.biz`),
    ];
    const candidates = getNgramCandidates(['haiku.trade'], bigRefList);
    // haiku.xyz should be in; most unrelated-corp-N.biz domains should be filtered
    expect(candidates).toContain('haiku.xyz');
    expect(candidates.length).toBeLessThan(bigRefList.length);
  });
});

// ---------------------------------------------------------------------------
// parseFuzzyResponse
// ---------------------------------------------------------------------------

describe('parseFuzzyResponse — valid JSON', () => {
  it('parses a well-formed LLM response', () => {
    const raw = JSON.stringify([
      {
        unmatched_domain: 'haiku.trade',
        matched_domain: 'haiku.xyz',
        confidence: 'medium',
        reasoning: 'Same brand, different TLD',
      },
    ]);
    const { matches, parseError } = parseFuzzyResponse(raw);
    expect(parseError).toBeUndefined();
    expect(matches).toHaveLength(1);
    expect(matches[0].unmatchedDomain).toBe('haiku.trade');
    expect(matches[0].matchedDomain).toBe('haiku.xyz');
    expect(matches[0].confidence).toBe('medium');
  });

  it('handles empty array response', () => {
    const { matches, parseError } = parseFuzzyResponse('[]');
    expect(parseError).toBeUndefined();
    expect(matches).toHaveLength(0);
  });

  it('normalizes domains in the response', () => {
    const raw = JSON.stringify([
      {
        unmatched_domain: 'HAIKU.TRADE',
        matched_domain: 'https://www.haiku.xyz/',
        confidence: 'low',
        reasoning: 'test',
      },
    ]);
    const { matches } = parseFuzzyResponse(raw);
    expect(matches[0].unmatchedDomain).toBe('haiku.trade');
    expect(matches[0].matchedDomain).toBe('haiku.xyz');
  });

  it('strips markdown fences from response', () => {
    const raw = '```json\n[{"unmatched_domain":"a.trade","matched_domain":"a.xyz","confidence":"medium","reasoning":"x"}]\n```';
    const { matches } = parseFuzzyResponse(raw);
    expect(matches).toHaveLength(1);
  });
});

describe('parseFuzzyResponse — invalid/edge cases', () => {
  it('returns parseError for invalid JSON', () => {
    const { matches, parseError } = parseFuzzyResponse('not valid json {{{');
    expect(parseError).toBeDefined();
    expect(matches).toHaveLength(0);
  });

  it('returns parseError when response is not an array', () => {
    const { matches, parseError } = parseFuzzyResponse('{"some": "object"}');
    expect(parseError).toBeDefined();
    expect(matches).toHaveLength(0);
  });

  it('skips items with null matched_domain', () => {
    const raw = JSON.stringify([
      { unmatched_domain: 'foo.trade', matched_domain: null, confidence: 'medium', reasoning: '' },
    ]);
    const { matches } = parseFuzzyResponse(raw);
    expect(matches).toHaveLength(0);
  });

  it('skips items where matched_domain equals unmatched_domain (circular)', () => {
    const raw = JSON.stringify([
      { unmatched_domain: 'foo.io', matched_domain: 'foo.io', confidence: 'medium', reasoning: '' },
    ]);
    const { matches } = parseFuzzyResponse(raw);
    expect(matches).toHaveLength(0);
  });

  it('skips items with invalid confidence value', () => {
    const raw = JSON.stringify([
      { unmatched_domain: 'foo.trade', matched_domain: 'foo.xyz', confidence: 'high', reasoning: '' },
    ]);
    const { matches } = parseFuzzyResponse(raw);
    // 'high' is not a valid fuzzy confidence — only 'medium' and 'low' are
    expect(matches).toHaveLength(0);
  });

  it('handles malformed items gracefully (skips them)', () => {
    const raw = JSON.stringify([
      null,
      42,
      { unmatched_domain: 'a.trade', matched_domain: 'a.xyz', confidence: 'medium', reasoning: 'ok' },
    ]);
    const { matches } = parseFuzzyResponse(raw);
    expect(matches).toHaveLength(1);
    expect(matches[0].unmatchedDomain).toBe('a.trade');
  });
});
