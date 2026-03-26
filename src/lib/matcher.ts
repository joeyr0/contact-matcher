import { normalizeDomain, isGenericDomain } from './normalize.js';
import type { Sheet15Index, OptOutIndex, MatchResult } from './types';

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
  sfOptOut: '',
  sfOptOutSpecificContacts: '',
  sfOptOutNotes: '',
  matchMethod: 'no_match',
  matchConfidence: '',
  sfMatchedDomain: '',
};

export function matchDomain(
  domain: string,
  sheet15Index: Sheet15Index,
  optOutIndex: OptOutIndex,
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

  return {
    sfAccountName: accountName,
    sfAccountId: accountId,
    sfAccountOwner: accountOwner,
    sfOptOut: optOutMatch ? (optOutMatch.optOut ? 'TRUE' : 'FALSE') : '',
    sfOptOutSpecificContacts: optOutMatch
      ? optOutMatch.optOutSpecificContacts
        ? 'TRUE'
        : 'FALSE'
      : '',
    sfOptOutNotes: optOutMatch?.notes ?? '',
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

  const base = matchDomain(matchedDomain, sheet15Index, optOutIndex);
  if (base.matchMethod === 'no_match') return null;

  return { ...base, matchMethod: 'name_match', matchConfidence: 'medium' };
}
