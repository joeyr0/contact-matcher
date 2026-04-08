import { extractContactFields, getPreferredCompanyDomain, getPreferredCompanyName } from './icp.js';
import type { AccountPitchCandidate, EnrichedRow, OutboundCandidate } from './types';

export type OutboundScope = 'direct' | 'direct_queue';

function getFirstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}

export function buildOutboundCandidates(
  headers: string[],
  results: EnrichedRow[],
  scope: OutboundScope,
): OutboundCandidate[] {
  return results.flatMap((row, index) => {
    const leadPriority = row.match.leadPriority;
    if (leadPriority !== 'direct' && !(scope === 'direct_queue' && leadPriority === 'queue')) {
      return [];
    }

    if (
      row.match.accountPriority !== 'p0' &&
      row.match.accountPriority !== 'p1' &&
      row.match.accountPriority !== 'p2'
    ) {
      return [];
    }

    if (
      row.match.contactPriority !== 'high' &&
      row.match.contactPriority !== 'medium' &&
      row.match.contactPriority !== 'low'
    ) {
      return [];
    }

    const contact = extractContactFields(headers, row.originalRow);
    if (!contact.name || !contact.title) return [];

    return [
      {
        key: String(index),
        firstName: getFirstName(contact.name),
        fullName: contact.name,
        title: contact.title,
        email: contact.email,
        company: getPreferredCompanyName(row),
        domain: getPreferredCompanyDomain(row) || row.domain,
        accountPriority: row.match.accountPriority,
        contactPriority: row.match.contactPriority,
        leadPriority,
        primaryUseCase: row.match.primaryUseCase,
        icpReasonSummary: row.match.icpReasonSummary,
        contactReasonSummary: row.match.contactReasonSummary,
        roleFit: row.match.roleFit,
      },
    ];
  });
}

export function buildAccountPitchCandidates(
  headers: string[],
  results: EnrichedRow[],
): AccountPitchCandidate[] {
  const seen = new Set<string>();
  const descIdx = headers.findIndex((h) => /^description$/i.test(h.trim()));

  return results.flatMap((row, index) => {
    const ap = row.match.accountPriority;
    if (ap !== 'p0' && ap !== 'p1' && ap !== 'p2') return [];
    const icpScore = row.match.icpScore;
    if (!icpScore || icpScore < 3) return [];

    const company = getPreferredCompanyName(row);
    const domain = getPreferredCompanyDomain(row) || row.domain;
    const dedupeKey = domain || company;
    if (seen.has(dedupeKey)) return [];
    seen.add(dedupeKey);

    const description = descIdx >= 0 ? (row.originalRow[descIdx] ?? '').trim() : '';

    return [
      {
        key: String(index),
        company,
        domain,
        accountPriority: ap,
        icpScore,
        primaryUseCase: row.match.primaryUseCase,
        icpReasonSummary: row.match.icpReasonSummary,
        description,
      },
    ];
  });
}
