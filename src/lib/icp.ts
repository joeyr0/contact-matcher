import type { EnrichedRow, MatchResult } from './types';
import { normalizeDomain, isGenericDomain } from './normalize';
import { canonicalizeCustomerName, getDomainRoot } from './matcher';

export type AccountStatus = MatchResult['accountStatus'];
export type AccountPriority = MatchResult['accountPriority'];
export type ContactPriority = MatchResult['contactPriority'];
export type LeadPriority = MatchResult['leadPriority'];

const NAME_HEADER_NAMES = new Set([
  'name',
  'full name',
  'full_name',
  'fullname',
  'contact',
  'contact name',
  'contact_name',
]);

const FIRST_NAME_HEADER_NAMES = new Set([
  'first name',
  'first_name',
  'firstname',
]);

const LAST_NAME_HEADER_NAMES = new Set([
  'last name',
  'last_name',
  'lastname',
]);

const TITLE_HEADER_NAMES = new Set([
  'title',
  'job title',
  'job_title',
  'role',
  'position',
  'current title',
]);

const KNOWN_COMPETITOR_NAMES = [
  'stripe',
  'magic',
  'magic labs',
  'dynamic',
  'fireblocks',
  'dfns',
  'privy',
  'utila',
  'portal',
  'evervault',
  'coinbase cdp',
  'crossmint',
  'sodot',
  'cubist',
  'particle network',
  'eigen cloud',
  'openfort',
  'para',
  'web3auth',
  'capsule',
  'marlin',
  'thirdweb',
  'lit protocol',
  'zero hash',
  'verve wallet',
  'shield',
  'blade',
  'cilantro',
  'pay protocol',
  'trilema wallet',
  'tin foil',
].map((value) => canonicalizeCustomerName(value));

const KNOWN_COMPETITOR_DOMAINS = new Set([
  'stripe.com',
  'magic.link',
  'dynamic.xyz',
  'fireblocks.com',
  'dfns.co',
  'privy.io',
  'utila.io',
  'portalhq.io',
  'evervault.com',
  'cdp.coinbase.com',
  'crossmint.com',
  'sodot.dev',
  'cubist.dev',
  'particle.network',
  'eigencloud.xyz',
  'openfort.io',
  'getpara.com',
  'web3auth.io',
  'usecapsule.com',
  'marlin.org',
  'thirdweb.com',
  'litprotocol.com',
  'zerohash.com',
  'vervewallet.com',
  'shield.xyz',
  'bladewallet.io',
  'cilantro.io',
  'payprotocol.xyz',
  'trilema.com',
  'tinfoil.sh',
]);

const OBVIOUS_EXCLUDE_TITLE_PATTERNS = [
  /\bhr\b/i,
  /\bhuman resources\b/i,
  /\brecruit/i,
  /\btalent\b/i,
  /\bpeople ops\b/i,
  /\boffice manager\b/i,
  /\badministrative\b/i,
  /\bexecutive assistant\b/i,
  /\bjournalist\b/i,
  /\breporter\b/i,
  /\bpr\b/i,
  /\bintern\b/i,
  /\bstudent\b/i,
  /\bco-?op\b/i,
];

const LOW_PRIORITY_TITLE_PATTERNS = [
  /\bbd\b/i,
  /\bbusiness development\b/i,
  /\bbiz dev\b/i,
  /\bbiz ops\b/i,
  /\bbusiness ops\b/i,
  /\bgrowth\b/i,
  /\bpartnerships?\b/i,
  /\bmarketing\b/i,
  /\bsales\b/i,
];

export interface AccountRoute {
  status: AccountStatus;
  isCompetitor: boolean;
  reason: string;
}

export interface ContactFields {
  name: string;
  title: string;
  email: string;
  hasStructuredContact: boolean;
}

export interface ScoreableCompany {
  key: string;
  company: string;
  domain: string;
  rowIndexes: number[];
}

export interface CompanyScoreInput {
  key: string;
  company: string;
  domain: string;
}

export interface CompanyScoreResult {
  key: string;
  icpScore: 1 | 2 | 3 | 4 | 5;
  confidence: 'high' | 'medium' | 'low';
  primaryUseCase: string;
  tvcScore: 1 | 2 | 3 | 4 | 5;
  reasonSummary: string;
  isReferralSource: boolean;
  isCompetitor: boolean;
}

export interface ContactScoreInput {
  key: string;
  companyKey: string;
  name: string;
  title: string;
  email: string;
  company: string;
  domain: string;
  accountPriority: 'p0' | 'p1' | 'p2';
  icpScore: 3 | 4 | 5;
  primaryUseCase: string;
}

export interface ContactScoreResult {
  key: string;
  contactScore: 1 | 2 | 3 | 4 | 5;
  roleFit: string;
  reasonSummary: string;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ');
}

function findHeaderIndex(headers: string[], candidates: Set<string>, includesPatterns: string[] = []): number {
  return headers.findIndex((header) => {
    const normalized = normalizeHeader(header);
    if (candidates.has(normalized)) return true;
    return includesPatterns.some((pattern) => normalized.includes(pattern));
  });
}

export function extractContactFields(headers: string[], row: string[]): ContactFields {
  const nameIdx = findHeaderIndex(headers, NAME_HEADER_NAMES, ['contact name']);
  const firstNameIdx = findHeaderIndex(headers, FIRST_NAME_HEADER_NAMES);
  const lastNameIdx = findHeaderIndex(headers, LAST_NAME_HEADER_NAMES);
  const titleIdx = findHeaderIndex(headers, TITLE_HEADER_NAMES, ['job title', 'title', 'role']);
  const emailIdx = headers.findIndex((header) => normalizeHeader(header) === 'email');

  const fullName = nameIdx >= 0 ? (row[nameIdx] ?? '').trim() : '';
  const firstName = firstNameIdx >= 0 ? (row[firstNameIdx] ?? '').trim() : '';
  const lastName = lastNameIdx >= 0 ? (row[lastNameIdx] ?? '').trim() : '';
  const derivedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const name = fullName || derivedName;
  const title = titleIdx >= 0 ? (row[titleIdx] ?? '').trim() : '';
  const email = emailIdx >= 0 ? (row[emailIdx] ?? '').trim() : '';

  return {
    name,
    title,
    email,
    hasStructuredContact: Boolean(name || title || email),
  };
}

export function getPreferredCompanyName(row: EnrichedRow): string {
  return row.match.sfAccountName || row.companyName || getDomainRoot(row.domain);
}

export function getPreferredCompanyDomain(row: EnrichedRow): string {
  return row.match.sfMatchedDomain || row.domain || '';
}

export function getCompanyKey(row: EnrichedRow): string {
  const company = canonicalizeCustomerName(getPreferredCompanyName(row));
  const domain = normalizeDomain(getPreferredCompanyDomain(row));
  return domain || company;
}

export function isKnownCompetitor(companyName: string, domain: string, sfAccountName = ''): boolean {
  const candidates = [
    canonicalizeCustomerName(companyName),
    canonicalizeCustomerName(sfAccountName),
    canonicalizeCustomerName(getDomainRoot(domain)),
  ].filter(Boolean);

  if (KNOWN_COMPETITOR_DOMAINS.has(normalizeDomain(domain))) return true;

  return candidates.some((candidate) => KNOWN_COMPETITOR_NAMES.includes(candidate));
}

export function classifyAccountRoute(row: EnrichedRow): AccountRoute {
  const companyName = row.companyName || row.match.sfAccountName;
  const domain = getPreferredCompanyDomain(row);
  if (isKnownCompetitor(companyName, domain, row.match.sfAccountName)) {
    return { status: 'competitor', isCompetitor: true, reason: 'Known competitor' };
  }
  if (row.match.sfOptOut === 'TRUE') {
    return { status: 'opted_out', isCompetitor: false, reason: 'Full opt-out' };
  }
  if (row.match.isCustomer === 'yes') {
    return { status: 'customer', isCompetitor: false, reason: 'Existing customer' };
  }
  if (row.match.isCustomer === 'maybe') {
    return { status: 'customer_review', isCompetitor: false, reason: 'Possible customer review' };
  }
  return { status: 'eligible', isCompetitor: false, reason: '' };
}

export function mapAccountPriority(icpScore: number): AccountPriority {
  if (icpScore >= 5) return 'p0';
  if (icpScore === 4) return 'p1';
  if (icpScore === 3) return 'p2';
  return 'not_target';
}

export function mapTvcRelevance(tvcScore: number): MatchResult['tvcRelevance'] {
  if (tvcScore >= 4) return 'high';
  if (tvcScore === 3) return 'medium';
  if (tvcScore >= 1) return 'low';
  return '';
}

export function mapContactPriority(contactScore: number): ContactPriority {
  if (contactScore >= 5) return 'high';
  if (contactScore === 4) return 'medium';
  if (contactScore === 3) return 'low';
  return 'exclude';
}

export function isObviousContactExclude(title: string): boolean {
  if (!title) return false;
  return OBVIOUS_EXCLUDE_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

export function isLowPriorityCommercialRole(title: string): boolean {
  if (!title) return false;
  return LOW_PRIORITY_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

export function computeLeadPriority(match: MatchResult): LeadPriority {
  if (!match.accountStatus || match.accountStatus !== 'eligible') return 'do_not_outreach';
  if (match.accountPriority === 'not_target' || match.accountPriority === 'excluded') return 'do_not_outreach';
  if (match.contactPriority === 'exclude') return 'do_not_outreach';

  if (!match.contactPriority) {
    if (match.accountPriority === 'p0' || match.accountPriority === 'p1') return 'queue';
    if (match.accountPriority === 'p2') return 'hold';
    return 'do_not_outreach';
  }

  if ((match.accountPriority === 'p0' || match.accountPriority === 'p1') && match.contactPriority === 'high') {
    return 'direct';
  }
  if (
    (match.accountPriority === 'p0' || match.accountPriority === 'p1') &&
    match.contactPriority === 'medium'
  ) {
    return 'queue';
  }
  if (match.accountPriority === 'p2' && match.contactPriority === 'high') {
    return 'queue';
  }
  if ((match.accountPriority === 'p0' || match.accountPriority === 'p1') && match.contactPriority === 'low') {
    return 'hold';
  }
  if (match.accountPriority === 'p2' && match.contactPriority === 'medium') {
    return 'hold';
  }
  if (match.accountPriority === 'p2' && match.contactPriority === 'low') {
    return 'do_not_outreach';
  }

  return 'do_not_outreach';
}

export function applyDeterministicAccountRoute(match: MatchResult, route: AccountRoute): MatchResult {
  const next = { ...match };
  next.accountStatus = route.status;
  next.isCompetitor = route.isCompetitor ? 'TRUE' : 'FALSE';

  if (route.status !== 'eligible') {
    next.accountPriority = 'excluded';
    next.leadPriority = 'do_not_outreach';
  }

  if (route.status === 'competitor') {
    next.icpReasonSummary = route.reason;
  }

  return next;
}

export function buildScoreableCompanies(results: EnrichedRow[]): ScoreableCompany[] {
  const byKey = new Map<string, ScoreableCompany>();
  results.forEach((row, index) => {
    if (row.match.accountStatus !== 'eligible') return;
    const domain = getPreferredCompanyDomain(row);
    if (!domain && !row.companyName && !row.match.sfAccountName) return;
    if (isGenericDomain(domain) && !row.companyName && !row.match.sfAccountName) return;

    const key = getCompanyKey(row);
    if (!key) return;

    const existing = byKey.get(key);
    if (existing) {
      existing.rowIndexes.push(index);
      return;
    }

    byKey.set(key, {
      key,
      company: getPreferredCompanyName(row),
      domain,
      rowIndexes: [index],
    });
  });
  return [...byKey.values()];
}
