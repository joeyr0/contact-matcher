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
  customerMatchMethod: '',
  possibleCustomer: '',
  possibleCustomerConfidence: '',
  possibleCustomerReason: '',
  customerTier: '',
  stripeSubscriptionStatus: '',
  arrCustomerName: '',
  matchMethod: 'no_match',
  matchConfidence: '',
  sfMatchedDomain: '',
};

interface CustomerLookup {
  activeByCanonicalName: Map<string, CommittedArrIndex[string]>;
  activeCustomers: Array<{
    record: CommittedArrIndex[string];
    canonicalName: string;
    tokens: string[];
  }>;
}

const customerLookupCache = new WeakMap<CommittedArrIndex, CustomerLookup>();

function canonicalizeCustomerName(name: string): string {
  return normalizeAccountName(
    name
      .replace(/\((prod|production|dev|development|staging|stage|testing|test|sandbox)\)/gi, ' ')
      .replace(/\b(prod|production|dev|development|staging|stage|testing|test|sandbox)\b/gi, ' '),
  );
}

function getDomainRoot(domain: string): string {
  const dot = domain.lastIndexOf('.');
  const root = dot !== -1 ? domain.slice(0, dot) : domain;
  const innerDot = root.lastIndexOf('.');
  return innerDot !== -1 ? root.slice(innerDot + 1) : root;
}

function tokenizeCustomerName(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/\((prod|production|dev|development|staging|stage|testing|test|sandbox)\)/gi, ' ')
    .replace(/\b(prod|production|dev|development|staging|stage|testing|test|sandbox)\b/gi, ' ')
    .replace(/\b(inc|llc|ltd|corp|corporation|technologies|technology|tech|labs|lab|protocol|foundation|dao|finance|financial|networks?|systems|group|holdings|ventures?|capital|partners?|global|digital|solutions|studios?|platforms?|services|software)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!cleaned) return [];
  return cleaned.split(/\s+/).filter((token) => token.length >= 3);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const next = new Array<number>(b.length + 1);

  for (let i = 0; i < a.length; i++) {
    next[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      next[j + 1] = Math.min(
        next[j] + 1,
        prev[j + 1] + 1,
        prev[j] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = next[j] ?? 0;
  }

  return prev[b.length] ?? 0;
}

function normalizedSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

interface PossibleCustomerMatch {
  record: CommittedArrIndex[string];
  confidence: 'medium' | 'low';
  reason: string;
}

function choosePreferredCustomer(
  current: CommittedArrIndex[string] | undefined,
  next: CommittedArrIndex[string],
): CommittedArrIndex[string] {
  if (!current) return next;
  if (current.subscriptionStatus !== 'active' && next.subscriptionStatus === 'active') return next;
  if (current.customerTier !== 'Enterprise' && next.customerTier === 'Enterprise') return next;
  return current;
}

function getCustomerLookup(arrIndex: CommittedArrIndex): CustomerLookup {
  const cached = customerLookupCache.get(arrIndex);
  if (cached) return cached;

  const activeByCanonicalName = new Map<string, CommittedArrIndex[string]>();
  const activeCustomers: CustomerLookup['activeCustomers'] = [];
  for (const record of Object.values(arrIndex)) {
    if (!record.isActiveCustomer) continue;
    const canonical = canonicalizeCustomerName(record.customerName);
    if (!canonical || canonical.length < 5) continue;
    activeByCanonicalName.set(
      canonical,
      choosePreferredCustomer(activeByCanonicalName.get(canonical), record),
    );
    activeCustomers.push({
      record,
      canonicalName: canonical,
      tokens: tokenizeCustomerName(record.customerName),
    });
  }

  const lookup = { activeByCanonicalName, activeCustomers };
  customerLookupCache.set(arrIndex, lookup);
  return lookup;
}

function findPossibleCustomerMatch(
  customerLookup: CustomerLookup,
  accountName: string,
  domain: string,
): PossibleCustomerMatch | null {
  const accountTokens = tokenizeCustomerName(accountName);
  const domainRoot = canonicalizeCustomerName(getDomainRoot(domain));
  const accountCanonical = canonicalizeCustomerName(accountName);

  const candidateKeys = new Set<string>();
  if (accountCanonical.length >= 5) candidateKeys.add(accountCanonical);
  if (domainRoot.length >= 5) candidateKeys.add(domainRoot);

  let best: { score: number; match: PossibleCustomerMatch } | null = null;

  for (const candidate of customerLookup.activeCustomers) {
    const arrCanonical = candidate.canonicalName;
    const arrTokens = candidate.tokens;

    let score = 0;
    let reason = '';

    for (const key of candidateKeys) {
      if (key === arrCanonical) continue;

      if (key.length >= 6 && arrCanonical.length >= 6 && (key.includes(arrCanonical) || arrCanonical.includes(key))) {
        const shorter = Math.min(key.length, arrCanonical.length);
        if (shorter >= 6) {
          const localScore = shorter >= 9 ? 0.9 : 0.84;
          if (localScore > score) {
            score = localScore;
            reason = 'strong canonical name containment';
          }
        }
      }

      const similarity = normalizedSimilarity(key, arrCanonical);
      if (similarity >= 0.86 && similarity > score) {
        score = similarity;
        reason = 'high canonical name similarity';
      }
    }

    if (accountTokens.length >= 2 && arrTokens.length >= 2) {
      const overlap = accountTokens.filter((token) => arrTokens.includes(token));
      const overlapRatio = overlap.length / Math.min(accountTokens.length, arrTokens.length);
      if (overlapRatio >= 1 && overlap.length >= 2) {
        const localScore = 0.88;
        if (localScore > score) {
          score = localScore;
          reason = 'full token overlap on multi-word company name';
        }
      } else if (overlapRatio >= 0.67 && overlap.length >= 2) {
        const localScore = 0.8;
        if (localScore > score) {
          score = localScore;
          reason = 'partial token overlap on company name';
        }
      }
    }

    if (score < 0.8) continue;
    const confidence: 'medium' | 'low' = score >= 0.86 ? 'medium' : 'low';
    const match = {
      record: candidate.record,
      confidence,
      reason,
    };

    if (!best || score > best.score) {
      best = { score, match };
    }
  }

  return best?.match ?? null;
}

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

  const directArrMatch = arrIndex && stripeCustomerId ? arrIndex[stripeCustomerId] : null;
  const hasArr = Boolean(arrIndex);
  const customerLookup = arrIndex ? getCustomerLookup(arrIndex) : null;
  const canonicalAccountName = canonicalizeCustomerName(accountName);
  const canonicalDomainRoot = canonicalizeCustomerName(getDomainRoot(domain));

  const inferredByName =
    !directArrMatch?.isActiveCustomer && customerLookup && canonicalAccountName.length >= 5
      ? customerLookup.activeByCanonicalName.get(canonicalAccountName) ?? null
      : null;

  const inferredByDomain =
    !directArrMatch?.isActiveCustomer && !inferredByName && customerLookup && canonicalDomainRoot.length >= 5
      ? customerLookup.activeByCanonicalName.get(canonicalDomainRoot) ?? null
      : null;

  const arrMatch = directArrMatch?.isActiveCustomer ? directArrMatch : inferredByName ?? inferredByDomain ?? directArrMatch ?? null;
  const customerMatchMethod: MatchResult['customerMatchMethod'] =
    directArrMatch?.isActiveCustomer
      ? 'stripe_id'
      : inferredByName
        ? 'account_name'
        : inferredByDomain
          ? 'domain_root'
          : '';
  const isActiveCustomer = Boolean(arrMatch?.isActiveCustomer);
  const possibleCustomerMatch =
    hasArr && !isActiveCustomer && customerLookup
      ? findPossibleCustomerMatch(customerLookup, accountName, domain)
      : null;

  // Treat active/past_due customers as "do not outreach" by default.
  const effectiveOptOut = Boolean(optOutMatch?.optOut) || isActiveCustomer;
  const optOutNotesBase = optOutMatch?.notes ?? '';
  const autoNote =
    customerMatchMethod === 'stripe_id'
      ? 'Active customer (Committed ARR via Stripe ID)'
      : customerMatchMethod === 'account_name'
        ? 'Active customer (Committed ARR via account name)'
        : customerMatchMethod === 'domain_root'
          ? 'Active customer (Committed ARR via domain root)'
          : '';
  const combinedNotes = [optOutNotesBase, autoNote].filter(Boolean).join(' · ');

  return {
    sfAccountName: accountName,
    sfAccountId: accountId,
    sfAccountOwner: accountOwner,
    stripeCustomerId,
    tkCustomerId,
    sfOptOut: hasArr || optOutMatch ? (effectiveOptOut ? 'TRUE' : 'FALSE') : '',
    sfOptOutSpecificContacts: optOutMatch
      ? optOutMatch.optOutSpecificContacts
        ? 'TRUE'
        : 'FALSE'
      : '',
    sfOptOutNotes: combinedNotes,
    isActiveCustomer: hasArr ? (isActiveCustomer ? 'TRUE' : 'FALSE') : '',
    customerMatchMethod,
    possibleCustomer: hasArr ? (possibleCustomerMatch ? 'TRUE' : 'FALSE') : '',
    possibleCustomerConfidence: possibleCustomerMatch?.confidence ?? '',
    possibleCustomerReason: possibleCustomerMatch
      ? `${possibleCustomerMatch.reason}: ${possibleCustomerMatch.record.customerName}`
      : '',
    customerTier: arrMatch?.customerTier ?? '',
    stripeSubscriptionStatus: arrMatch?.subscriptionStatus ?? possibleCustomerMatch?.record.subscriptionStatus ?? '',
    arrCustomerName: arrMatch?.customerName ?? possibleCustomerMatch?.record.customerName ?? '',
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
