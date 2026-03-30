import { describe, it, expect } from 'vitest';
import { buildSheet15Index, buildCommittedArrIndex } from '../lib/indexer';

describe('buildSheet15Index — salesforce_all_accounts schema', () => {
  it('maps Website → domain and includes Stripe ID', () => {
    const csv = [
      '"Last Activity","Account Owner","Account Name","Billing State/Province","Type","Last Modified Date","Account ID","Stripe ID","TK Customer ID","Website"',
      '"1/12/2026","Carolyn Philips","TreasuryPath","","","3/30/2026","001Wj00000tQWvr","","","treasurypath.com"',
      '"2/5/2026","Eric Gremli","Latitude","","","3/30/2026","001Wj00000tiSsB","cus_TwobJOLlWwWRa4","","latitude.xyz"',
    ].join('\n');

    const result = buildSheet15Index(csv);
    expect(result.error).toBeUndefined();
    expect(result.uniqueCount).toBe(2);
    expect(result.index['treasurypath.com']?.accountId).toBe('001Wj00000tQWvr');
    expect(result.index['latitude.xyz']?.stripeCustomerId).toBe('cus_TwobJOLlWwWRa4');
  });
});

describe('buildCommittedArrIndex', () => {
  it('finds the header row and aggregates status/tier per customer', () => {
    const csv = [
      ',,,,,',
      ',Customer ID,Customer Name,Account Owner,Stripe Subscription Status,Product Name',
      ',cus_1,Acme,Joey,active,Enterprise',
      ',cus_1,Acme,Joey,canceled,Pro',
      ',cus_2,Beta,-,past_due,Pro',
    ].join('\n');

    const result = buildCommittedArrIndex(csv);
    expect(result.error).toBeUndefined();
    expect(result.uniqueCount).toBe(2);

    const c1 = result.index['cus_1'];
    expect(c1.isActiveCustomer).toBe(true);
    expect(c1.customerTier).toBe('Enterprise');
    expect(c1.subscriptionStatus).toBe('active');

    const c2 = result.index['cus_2'];
    expect(c2.isActiveCustomer).toBe(true);
    expect(c2.customerTier).toBe('Pro');
    expect(c2.subscriptionStatus).toBe('past_due');
  });
});

