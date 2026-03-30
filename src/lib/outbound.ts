import { extractContactFields, getPreferredCompanyDomain, getPreferredCompanyName } from './icp';
import type { EnrichedRow, OutboundCandidate } from './types';

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
