import { normalizeDomain, isGenericDomain } from './normalize.js';
import type { Sheet15Index, OptOutIndex, CommittedArrIndex, MatchResult } from './types';

export function extractDomain(email: string): string {
  if (!email || typeof email !== 'string') return '';
  const atIdx = email.indexOf('@');
  if (atIdx === -1) return '';
  return normalizeDomain(email.slice(atIdx + 1));
}

const NO_MATCH: MatchResult = {
  sfAccountName: '',
  sfAccountId: '',
  sfAccountOwner: '',
  stripeCustomerId: '',
  tkCustomerId: '',
  sfOptOut: '',
  sfOptOutSpecificContacts: '',
  sfOptOutNotes: '',
  isActiveCustomer: '',
  customerTier: '',
  stripeSubscriptionStatus: '',
  arrCustomerName: '',
  matchMethod: 'no_match',
  matchConfidence: '',
  sfMatchedDomain: '',
};

export function matchDomain(
  domain: string,
  sheet15Index: Sheet15Index,
  optOutIndex: OptOutIndex,
  arrIndex?: CommittedArrIndex | null,
): MatchResult {
  if (!domain || isGenericDomain(domain)) {
    return { ...NO_MATCH };
  }

  const sheet15Match = sheet15Index[domain];
  const optOutMatch = optOutIndex[domain];

  if (!sheet15Match && !optOutMatch) {
    return { ...NO_MATCH };
  }

  // Sheet15 is authoritative for account data; opt-out adds flags
  const accountName = sheet15Match?.accountName ?? optOutMatch?.accountName ?? '';
  const accountId = sheet15Match?.accountId ?? '';
  const accountOwner = sheet15Match?.accountOwner ?? optOutMatch?.accountOwner ?? '';
  const stripeCustomerId = (sheet15Match?.stripeCustomerId ?? '').trim();
  const tkCustomerId = (sheet15Match?.tkCustomerId ?? '').trim();

  const arrMatch = arrIndex && stripeCustomerId ? arrIndex[stripeCustomerId] : null;
  const hasArr = Boolean(arrIndex);

  return {
    sfAccountName: accountName,
    sfAccountId: accountId,
    sfAccountOwner: accountOwner,
    stripeCustomerId,
    tkCustomerId,
    sfOptOut: optOutMatch ? (optOutMatch.optOut ? 'TRUE' : 'FALSE') : '',
    sfOptOutSpecificContacts: optOutMatch
      ? optOutMatch.optOutSpecificContacts
        ? 'TRUE'
        : 'FALSE'
      : '',
    sfOptOutNotes: optOutMatch?.notes ?? '',
    isActiveCustomer: hasArr ? (arrMatch?.isActiveCustomer ? 'TRUE' : 'FALSE') : '',
    customerTier: arrMatch?.customerTier ?? '',
    stripeSubscriptionStatus: arrMatch?.subscriptionStatus ?? '',
    arrCustomerName: arrMatch?.customerName ?? '',
    matchMethod: 'exact',
    matchConfidence: 'high',
    sfMatchedDomain: domain,
  };
}

/**
 * Normalize an account name for name-based matching.
 * Strips common corporate/web3 suffixes and non-alphanumeric chars.
 */
export function normalizeAccountName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|technologies|technology|tech|labs|lab|protocol|foundation|dao|finance|financial|networks?|systems|group|holdings|ventures?|capital|partners?|global|digital|solutions|studios?|platforms?|services|software)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Build a map: normalizedAccountName → first Sheet15 domain with that account name.
 * Used for Tier 1.5 matching (blockaid.io → blockaid.co via "Blockaid" account name).
 */
export function buildAccountNameIndex(sheet15Index: Sheet15Index): Map<string, string> {
  const nameIndex = new Map<string, string>();
  for (const [domain, record] of Object.entries(sheet15Index)) {
    if (!record.accountName) continue;
    const normalized = normalizeAccountName(record.accountName);
    if (normalized.length >= 7 && !nameIndex.has(normalized)) {
      nameIndex.set(normalized, domain);
    }
  }
  return nameIndex;
}

// Generic crypto/finance words that survive normalizeAccountName but are too common to match on
const COMPANY_MATCH_BLOCKLIST = new Set([
  'genesis', 'balance', 'polygon', 'trading', 'exchange', 'markets',
  'staking', 'bitcoin', 'ethereum', 'blockchain', 'venture', 'funding',
  'lending', 'borrowing', 'custody', 'clearing', 'settlement',
]);

/**
 * Tier 1.7: match an unmatched domain using an explicit company name from the contact row.
 * e.g. company = "Accenture" → normalized "accenture" → nameIndex["accenture"] = "accenture.com"
 * Only exact normalized matches; no partial matching.
 */
export function matchByCompanyName(
  companyName: string,
  nameIndex: Map<string, string>,
  sheet15Index: Sheet15Index,
  optOutIndex: OptOutIndex,
  arrIndex?: CommittedArrIndex | null,
): MatchResult | null {
  if (!companyName) return null;
  const normalized = normalizeAccountName(companyName);
  if (normalized.length < 7) return null;
  if (COMPANY_MATCH_BLOCKLIST.has(normalized)) return null;

  const matchedDomain = nameIndex.get(normalized);
  if (!matchedDomain) return null;

  const base = matchDomain(matchedDomain, sheet15Index, optOutIndex, arrIndex);
  if (base.matchMethod === 'no_match') return null;

  return { ...base, matchMethod: 'company_match', matchConfidence: 'medium' };
}

/**
 * Tier 1.5: try to match an unmatched domain by its root name against account names.
 * e.g. blockaid.io → root "blockaid" → nameIndex["blockaid"] = "blockaid.co" → match.
 * Returns null if no match found.
 */
export function matchByName(
  unmatchedDomain: string,
  nameIndex: Map<string, string>,
  sheet15Index: Sheet15Index,
  optOutIndex: OptOutIndex,
  arrIndex?: CommittedArrIndex | null,
): MatchResult | null {
  const dot = unmatchedDomain.lastIndexOf('.');
  const root = dot !== -1 ? unmatchedDomain.slice(0, dot) : unmatchedDomain;
  // Handle subdomains: app.company.io → use "company" not "app.company"
  const innerDot = root.lastIndexOf('.');
  const effectiveRoot = innerDot !== -1 ? root.slice(innerDot + 1) : root;

  const normalizedRoot = normalizeAccountName(effectiveRoot);
  if (normalizedRoot.length < 7) return null;

  const matchedDomain = nameIndex.get(normalizedRoot);
  if (!matchedDomain || matchedDomain === unmatchedDomain) return null;

  const base = matchDomain(matchedDomain, sheet15Index, optOutIndex, arrIndex);
  if (base.matchMethod === 'no_match') return null;

  return { ...base, matchMethod: 'name_match', matchConfidence: 'medium' };
}
