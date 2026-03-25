import { normalizeDomain, isGenericDomain } from './normalize';
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
  };
}
