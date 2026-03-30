import { describe, expect, it } from 'vitest';
import {
  classifyAccountRoute,
  computeLeadPriority,
  isKnownCompetitor,
  mapAccountPriority,
  mapContactPriority,
} from '../lib/icp';
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
    accountStatus: '',
    accountPriority: '',
    icpScore: '',
    icpConfidence: '',
    primaryUseCase: '',
    tvcScore: '',
    tvcRelevance: '',
    icpReasonSummary: '',
    isCompetitor: '',
    contactScore: '',
    contactPriority: '',
    roleFit: '',
    contactReasonSummary: '',
    leadPriority: '',
    matchMethod: 'no_match',
    matchConfidence: '',
    sfMatchedDomain: '',
    ...overrides,
  };
}

function makeRow(overrides: Partial<EnrichedRow> = {}): EnrichedRow {
  return {
    originalRow: [],
    domain: 'example.com',
    companyName: 'Example',
    match: makeMatch(),
    ...overrides,
  };
}

describe('isKnownCompetitor', () => {
  it('flags explicit competitor domains', () => {
    expect(isKnownCompetitor('Stripe', 'stripe.com')).toBe(true);
    expect(isKnownCompetitor('Fireblocks', 'fireblocks.com')).toBe(true);
  });

  it('does not flag unrelated companies', () => {
    expect(isKnownCompetitor('Bridge', 'bridge.xyz')).toBe(false);
  });
});

describe('classifyAccountRoute', () => {
  it('marks competitors ahead of normal prospect routing', () => {
    const route = classifyAccountRoute(makeRow({ companyName: 'Privy', domain: 'privy.io' }));
    expect(route.status).toBe('competitor');
  });

  it('marks existing customers for exclusion', () => {
    const route = classifyAccountRoute(makeRow({ match: makeMatch({ isCustomer: 'yes' }) }));
    expect(route.status).toBe('customer');
  });
});

describe('priority mapping', () => {
  it('maps company scores to p0/p1/p2/not_target', () => {
    expect(mapAccountPriority(5)).toBe('p0');
    expect(mapAccountPriority(4)).toBe('p1');
    expect(mapAccountPriority(3)).toBe('p2');
    expect(mapAccountPriority(2)).toBe('not_target');
  });

  it('maps contact scores to high/medium/low/exclude', () => {
    expect(mapContactPriority(5)).toBe('high');
    expect(mapContactPriority(4)).toBe('medium');
    expect(mapContactPriority(3)).toBe('low');
    expect(mapContactPriority(1)).toBe('exclude');
  });
});

describe('computeLeadPriority', () => {
  it('routes p0 + high to direct', () => {
    expect(computeLeadPriority(makeMatch({ accountStatus: 'eligible', accountPriority: 'p0', contactPriority: 'high' }))).toBe('direct');
  });

  it('routes p2 + low to do_not_outreach', () => {
    expect(computeLeadPriority(makeMatch({ accountStatus: 'eligible', accountPriority: 'p2', contactPriority: 'low' }))).toBe('do_not_outreach');
  });

  it('routes excluded statuses to do_not_outreach', () => {
    expect(computeLeadPriority(makeMatch({ accountStatus: 'competitor', accountPriority: 'excluded' }))).toBe('do_not_outreach');
  });
});
