import { describe, it, expect } from 'vitest';
import { extractDomain, matchDomain } from '../lib/matcher';
import type { Sheet15Index, OptOutIndex } from '../lib/types';

// --- extractDomain ---

describe('extractDomain', () => {
  it('extracts domain from standard email', () => {
    expect(extractDomain('alice@example.com')).toBe('example.com');
  });

  it('normalizes the extracted domain', () => {
    expect(extractDomain('alice@WWW.EXAMPLE.COM')).toBe('example.com');
  });

  it('returns empty string for missing @', () => {
    expect(extractDomain('notanemail')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(extractDomain('')).toBe('');
  });

  it('handles email with subdomain', () => {
    expect(extractDomain('user@feedback.brex.com')).toBe('feedback.brex.com');
  });
});

// --- matchDomain ---

const sheet15: Sheet15Index = {
  'matterlabs.dev': { accountId: 'ACC001', accountName: 'Matter Labs', accountOwner: 'Duncan Acres' },
  'optimism.io': { accountId: 'ACC002', accountName: 'OP Labs / Optimism', accountOwner: 'Duncan Acres' },
  'shinami.com': { accountId: 'ACC003', accountName: 'Shinami', accountOwner: 'Jane Smith' },
};

const optOut: OptOutIndex = {
  'matterlabs.dev': {
    accountName: 'Matter Labs',
    accountOwner: 'Duncan Acres',
    optOut: true,
    optOutSpecificContacts: false,
    notes: '',
  },
  'oplabs.co': {
    accountName: 'OP Labs / Optimism',
    accountOwner: 'Duncan Acres',
    optOut: true,
    optOutSpecificContacts: false,
    notes: '',
  },
  'optimism.io': {
    accountName: 'OP Labs / Optimism',
    accountOwner: 'Duncan Acres',
    optOut: true,
    optOutSpecificContacts: false,
    notes: '',
  },
  'rareco.xyz': {
    accountName: 'Rare Co',
    accountOwner: 'Bob Jones',
    optOut: true,
    optOutSpecificContacts: false,
    notes: '',
  },
  'specificonly.io': {
    accountName: 'Specific Only Corp',
    accountOwner: 'Carol',
    optOut: false,
    optOutSpecificContacts: true,
    notes: 'Erika and Tomas',
  },
};

describe('matchDomain — exact match, both indexes', () => {
  it('returns account data from Sheet15 and opt-out flag', () => {
    const result = matchDomain('matterlabs.dev', sheet15, optOut);
    expect(result.matchMethod).toBe('exact');
    expect(result.matchConfidence).toBe('high');
    expect(result.sfAccountName).toBe('Matter Labs');
    expect(result.sfAccountId).toBe('ACC001');
    expect(result.sfAccountOwner).toBe('Duncan Acres');
    expect(result.sfOptOut).toBe('TRUE');
    expect(result.sfOptOutSpecificContacts).toBe('FALSE');
  });
});

describe('matchDomain — Sheet15 only (no opt-out)', () => {
  it('returns account data, blank opt-out fields', () => {
    const result = matchDomain('shinami.com', sheet15, optOut);
    expect(result.matchMethod).toBe('exact');
    expect(result.sfAccountName).toBe('Shinami');
    expect(result.sfAccountId).toBe('ACC003');
    expect(result.sfOptOut).toBe('');
    expect(result.sfOptOutSpecificContacts).toBe('');
  });
});

describe('matchDomain — opt-out only (not in Sheet15)', () => {
  it('populates account from opt-out record, blank accountId, still exact match', () => {
    const result = matchDomain('rareco.xyz', sheet15, optOut);
    expect(result.matchMethod).toBe('exact');
    expect(result.sfAccountName).toBe('Rare Co');
    expect(result.sfAccountId).toBe(''); // not in Sheet15
    expect(result.sfAccountOwner).toBe('Bob Jones');
    expect(result.sfOptOut).toBe('TRUE');
  });
});

describe('matchDomain — no match', () => {
  it('returns no_match for unknown domain', () => {
    const result = matchDomain('unknownstartup.io', sheet15, optOut);
    expect(result.matchMethod).toBe('no_match');
    expect(result.sfAccountName).toBe('');
    expect(result.sfAccountId).toBe('');
    expect(result.sfOptOut).toBe('');
  });
});

describe('matchDomain — generic email domain', () => {
  it('returns no_match for gmail.com without index lookup', () => {
    const result = matchDomain('gmail.com', sheet15, optOut);
    expect(result.matchMethod).toBe('no_match');
  });

  it('returns no_match for yahoo.com', () => {
    const result = matchDomain('yahoo.com', sheet15, optOut);
    expect(result.matchMethod).toBe('no_match');
  });

  it('returns no_match for protonmail.com', () => {
    const result = matchDomain('protonmail.com', sheet15, optOut);
    expect(result.matchMethod).toBe('no_match');
  });
});

describe('matchDomain — empty/malformed domain', () => {
  it('returns no_match for empty domain', () => {
    const result = matchDomain('', sheet15, optOut);
    expect(result.matchMethod).toBe('no_match');
  });
});

describe('matchDomain — specific contacts only opt-out', () => {
  it('sets sfOptOut=FALSE and sfOptOutSpecificContacts=TRUE with notes', () => {
    const result = matchDomain('specificonly.io', sheet15, optOut);
    expect(result.sfOptOut).toBe('FALSE');
    expect(result.sfOptOutSpecificContacts).toBe('TRUE');
    expect(result.sfOptOutNotes).toBe('Erika and Tomas');
  });
});

describe('matchDomain — multi-domain opt-out expansion', () => {
  it('matches optimism.io from expanded multi-domain opt-out entry', () => {
    // optimism.io was expanded from "oplabs.co,optimism.io" in Phase 1 opt-out index
    const result = matchDomain('optimism.io', sheet15, optOut);
    expect(result.matchMethod).toBe('exact');
    expect(result.sfOptOut).toBe('TRUE');
    expect(result.sfAccountId).toBe('ACC002'); // also in Sheet15
  });

  it('matches oplabs.co even though it is only in opt-out index (not Sheet15)', () => {
    const result = matchDomain('oplabs.co', sheet15, optOut);
    expect(result.matchMethod).toBe('exact');
    expect(result.sfOptOut).toBe('TRUE');
    expect(result.sfAccountId).toBe(''); // not in Sheet15
    expect(result.sfAccountName).toBe('OP Labs / Optimism');
  });
});
