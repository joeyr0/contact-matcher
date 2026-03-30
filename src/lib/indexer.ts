import Papa from 'papaparse';
import { normalizeDomain, parseMultiDomain } from './normalize.js';
import type {
  Sheet15Index,
  OptOutIndex,
  CommittedArrIndex,
  Sheet15Record,
  OptOutRecord,
  CommittedArrRecord,
} from './types';

export interface ParseResult<T> {
  index: T;
  rowCount: number;
  uniqueCount: number;
  skippedRows: number;
  error?: string;
}

const SHEET15_REQUIRED_COLUMNS = ['Website__c', 'Account__r.Id', 'Account__r.Name', 'Account__r.Owner.Name'];
const OPTOUT_REQUIRED_COLUMNS = ['Account Owner', 'Account Name', 'Website', 'Outbound Opt Out', 'Only opt out specific contacts'];
const ALL_ACCOUNTS_REQUIRED_COLUMNS = ['Website', 'Account ID', 'Account Name', 'Account Owner', 'Stripe ID'];

export function buildSheet15Index(csvText: string): ParseResult<Sheet15Index> {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const foundColumns = result.meta.fields ?? [];

  const isLegacySheet15 = SHEET15_REQUIRED_COLUMNS.every((col) => foundColumns.includes(col));
  const isAllAccounts = ALL_ACCOUNTS_REQUIRED_COLUMNS.every((col) => foundColumns.includes(col));

  if (!isLegacySheet15 && !isAllAccounts) {
    const missingLegacy = SHEET15_REQUIRED_COLUMNS.filter((col) => !foundColumns.includes(col));
    const missingAll = ALL_ACCOUNTS_REQUIRED_COLUMNS.filter((col) => !foundColumns.includes(col));
    return {
      index: {},
      rowCount: 0,
      uniqueCount: 0,
      skippedRows: 0,
      error: `Unsupported Salesforce accounts CSV format. Expected either legacy Sheet15 columns (${SHEET15_REQUIRED_COLUMNS.join(', ')}) or salesforce_all_accounts columns (${ALL_ACCOUNTS_REQUIRED_COLUMNS.join(', ')}). Missing legacy: ${missingLegacy.join(', ')}. Missing all_accounts: ${missingAll.join(', ')}.`,
    };
  }

  if (result.data.length === 0) {
    return { index: {}, rowCount: 0, uniqueCount: 0, skippedRows: 0, error: 'CSV contains no data rows' };
  }

  const index: Sheet15Index = {};
  let skippedRows = 0;

  for (const row of result.data) {
    const raw = isLegacySheet15 ? row['Website__c'] : row['Website'];
    if (!raw || raw.trim() === '') {
      skippedRows++;
      continue;
    }
    const domain = normalizeDomain(raw);
    if (!domain) {
      skippedRows++;
      continue;
    }
    // First-match-wins for duplicates
    if (index[domain]) continue;

    const record: Sheet15Record = {
      accountId: (isLegacySheet15 ? row['Account__r.Id'] : row['Account ID']) ?? '',
      accountName: (isLegacySheet15 ? row['Account__r.Name'] : row['Account Name']) ?? '',
      accountOwner: (isLegacySheet15 ? row['Account__r.Owner.Name'] : row['Account Owner']) ?? '',
      stripeCustomerId: isAllAccounts ? (row['Stripe ID'] ?? '').trim() : '',
      tkCustomerId: isAllAccounts ? (row['TK Customer ID'] ?? '').trim() : '',
    };
    index[domain] = record;
  }

  return {
    index,
    rowCount: result.data.length,
    uniqueCount: Object.keys(index).length,
    skippedRows,
  };
}

export function buildOptOutIndex(csvText: string): ParseResult<OptOutIndex> {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const foundColumns = result.meta.fields ?? [];
  const missingColumns = OPTOUT_REQUIRED_COLUMNS.filter((col) => !foundColumns.includes(col));
  if (missingColumns.length > 0) {
    return {
      index: {},
      rowCount: 0,
      uniqueCount: 0,
      skippedRows: 0,
      error: `Missing required columns: ${missingColumns.join(', ')}. Found: ${foundColumns.join(', ')}`,
    };
  }

  if (result.data.length === 0) {
    return { index: {}, rowCount: 0, uniqueCount: 0, skippedRows: 0, error: 'CSV contains no data rows' };
  }

  const index: OptOutIndex = {};
  let skippedRows = 0;

  for (const row of result.data) {
    const raw = row['Website'];
    if (!raw || raw.trim() === '') {
      skippedRows++;
      continue;
    }

    const domains = parseMultiDomain(raw);
    if (domains.length === 0) {
      skippedRows++;
      continue;
    }

    const record: OptOutRecord = {
      accountName: row['Account Name'] ?? '',
      accountOwner: row['Account Owner'] ?? '',
      optOut: row['Outbound Opt Out']?.trim().toUpperCase() === 'TRUE',
      optOutSpecificContacts: row['Only opt out specific contacts']?.trim().toUpperCase() === 'TRUE',
      notes: row['Notes'] ?? '',
    };

    for (const domain of domains) {
      if (!index[domain]) {
        index[domain] = record;
      }
    }
  }

  return {
    index,
    rowCount: result.data.length,
    uniqueCount: Object.keys(index).length,
    skippedRows,
  };
}

function normalizeStatus(raw: string): string {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return '';
  return s;
}

function isActiveStatus(status: string): boolean {
  return status === 'active' || status === 'past_due';
}

function normalizeTier(productName: string): 'Enterprise' | 'Pro' | '' {
  const n = (productName ?? '').toLowerCase();
  if (n.includes('enterprise')) return 'Enterprise';
  if (n.includes('pro')) return 'Pro';
  return '';
}

export function buildCommittedArrIndex(csvText: string): ParseResult<CommittedArrIndex> {
  // ARR export has leading blank rows/columns; parse as raw rows and find the header row.
  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r) => Array.isArray(r)) as string[][];

  const headerRowIdx = rows.findIndex((r) => r.some((c) => (c ?? '').trim() === 'Customer ID'));
  if (headerRowIdx === -1) {
    return {
      index: {},
      rowCount: 0,
      uniqueCount: 0,
      skippedRows: 0,
      error: 'Could not find header row containing "Customer ID".',
    };
  }

  const header = rows[headerRowIdx].map((c) => (c ?? '').trim());
  const colIndex = (name: string): number => header.findIndex((h) => h === name);
  const customerIdIdx = colIndex('Customer ID');
  const customerNameIdx = colIndex('Customer Name');
  const accountOwnerIdx = colIndex('Account Owner');
  const statusIdx = colIndex('Stripe Subscription Status');
  const productIdx = colIndex('Product Name');

  if (customerIdIdx === -1 || statusIdx === -1 || productIdx === -1) {
    return {
      index: {},
      rowCount: 0,
      uniqueCount: 0,
      skippedRows: 0,
      error: `Missing required columns in ARR export. Found columns: ${header.filter(Boolean).join(', ')}`,
    };
  }

  type Accum = {
    customerId: string;
    customerName: string;
    accountOwner: string;
    statuses: Set<string>;
    tiers: Set<'Enterprise' | 'Pro'>;
  };

  const acc = new Map<string, Accum>();
  let skippedRows = 0;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const customerId = (row[customerIdIdx] ?? '').trim();
    if (!customerId) {
      skippedRows++;
      continue;
    }

    const status = normalizeStatus(row[statusIdx] ?? '');
    const tier = normalizeTier(row[productIdx] ?? '');

    let cur = acc.get(customerId);
    if (!cur) {
      cur = {
        customerId,
        customerName: (row[customerNameIdx] ?? '').trim(),
        accountOwner: (row[accountOwnerIdx] ?? '').trim(),
        statuses: new Set<string>(),
        tiers: new Set<'Enterprise' | 'Pro'>(),
      };
      acc.set(customerId, cur);
    } else {
      // Keep first non-empty customer name/owner if later rows are blank.
      if (!cur.customerName) cur.customerName = (row[customerNameIdx] ?? '').trim();
      if (!cur.accountOwner) cur.accountOwner = (row[accountOwnerIdx] ?? '').trim();
    }

    if (status) cur.statuses.add(status);
    if (tier) cur.tiers.add(tier);
  }

  const index: CommittedArrIndex = {};
  for (const [, a] of acc) {
    const hasActive = Array.from(a.statuses).some((s) => s === 'active');
    const hasPastDue = Array.from(a.statuses).some((s) => s === 'past_due');
    const effectiveStatus = hasActive ? 'active' : hasPastDue ? 'past_due' : (Array.from(a.statuses)[0] ?? '');

    const customerTier: 'Enterprise' | 'Pro' | '' =
      a.tiers.has('Enterprise') ? 'Enterprise' : a.tiers.has('Pro') ? 'Pro' : '';

    const record: CommittedArrRecord = {
      customerId: a.customerId,
      customerName: a.customerName,
      accountOwner: a.accountOwner,
      subscriptionStatus: effectiveStatus,
      isActiveCustomer: isActiveStatus(effectiveStatus),
      customerTier,
    };

    index[a.customerId] = record;
  }

  return {
    index,
    rowCount: rows.length - (headerRowIdx + 1),
    uniqueCount: Object.keys(index).length,
    skippedRows,
  };
}
