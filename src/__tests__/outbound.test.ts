import { describe, expect, it } from 'vitest';
import { buildOutboundCandidates } from '../lib/outbound';
import type { EnrichedRow, MatchResult } from '../lib/types';

function makeMatch(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    sfAccountName: '',
    sfAccountId: '',
    sfAccountOwner: '',
    stripeCustomerId: '',
    tkCustomerId: '',
    sfOptOut: '',
    sfOptOutSpecificContacts: '',
    sfOptOutNotes: '',
    isActiveCustomer: '',
    customerMatchMethod: '',
    customerMatchConfidence: '',
    isCustomer: 'no',
    possibleCustomer: '',
    possibleCustomerConfidence: '',
    possibleCustomerReason: '',
    customerTier: '',
    stripeSubscriptionStatus: '',
    arrCustomerName: '',
    accountStatus: 'eligible',
    accountPriority: 'p0',
    icpScore: 5,
    icpConfidence: 'high',
    primaryUseCase: 'payment_orchestration',
    tvcScore: '',
    tvcRelevance: '',
    tvcFitReason: '',
    icpReasonSummary: 'Clear stablecoin wallet need.',
    isCompetitor: 'FALSE',
    contactScore: 5,
    contactPriority: 'high',
    roleFit: 'decision_maker',
    contactReasonSummary: 'Senior owner.',
    leadPriority: 'direct',
    matchMethod: 'exact',
    matchConfidence: 'high',
    sfMatchedDomain: 'example.com',
    ...overrides,
  };
}

function makeRow(originalRow: string[], matchOverrides: Partial<MatchResult> = {}): EnrichedRow {
  return {
    originalRow,
    domain: 'example.com',
    companyName: 'Example',
    match: makeMatch(matchOverrides),
  };
}

describe('buildOutboundCandidates', () => {
  const headers = ['Full Name', 'Title', 'Email', 'Company'];

  it('includes only direct leads for direct scope', () => {
    const rows = [
      makeRow(['Jane Doe', 'VP Product', 'jane@example.com', 'Example'], { leadPriority: 'direct', contactPriority: 'medium' }),
      makeRow(['John Roe', 'Head of BD', 'john@example.com', 'Example'], { leadPriority: 'queue', contactPriority: 'medium' }),
    ];

    const candidates = buildOutboundCandidates(headers, rows, 'direct');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.fullName).toBe('Jane Doe');
  });

  it('includes queue leads for direct_queue scope', () => {
    const rows = [
      makeRow(['Jane Doe', 'VP Product', 'jane@example.com', 'Example'], { leadPriority: 'direct', contactPriority: 'medium' }),
      makeRow(['John Roe', 'Head of BD', 'john@example.com', 'Example'], { leadPriority: 'queue', contactPriority: 'medium' }),
    ];

    const candidates = buildOutboundCandidates(headers, rows, 'direct_queue');
    expect(candidates).toHaveLength(2);
  });

  it('skips rows without usable contact name and title', () => {
    const rows = [makeRow(['', '', 'jane@example.com', 'Example'])];
    const candidates = buildOutboundCandidates(headers, rows, 'direct');
    expect(candidates).toHaveLength(0);
  });
});
