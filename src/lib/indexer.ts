import Papa from 'papaparse';
import { normalizeDomain, parseMultiDomain } from './normalize.js';
import type { Sheet15Index, OptOutIndex, Sheet15Record, OptOutRecord } from './types';

export interface ParseResult<T> {
  index: T;
  rowCount: number;
  uniqueDomains: number;
  skippedRows: number;
  error?: string;
}

const SHEET15_REQUIRED_COLUMNS = ['Website__c', 'Account__r.Id', 'Account__r.Name', 'Account__r.Owner.Name'];
const OPTOUT_REQUIRED_COLUMNS = ['Account Owner', 'Account Name', 'Website', 'Outbound Opt Out', 'Only opt out specific contacts'];

export function buildSheet15Index(csvText: string): ParseResult<Sheet15Index> {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const foundColumns = result.meta.fields ?? [];
  const missingColumns = SHEET15_REQUIRED_COLUMNS.filter((col) => !foundColumns.includes(col));
  if (missingColumns.length > 0) {
    return {
      index: {},
      rowCount: 0,
      uniqueDomains: 0,
      skippedRows: 0,
      error: `Missing required columns: ${missingColumns.join(', ')}. Found: ${foundColumns.join(', ')}`,
    };
  }

  if (result.data.length === 0) {
    return { index: {}, rowCount: 0, uniqueDomains: 0, skippedRows: 0, error: 'CSV contains no data rows' };
  }

  const index: Sheet15Index = {};
  let skippedRows = 0;

  for (const row of result.data) {
    const raw = row['Website__c'];
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
      accountId: row['Account__r.Id'] ?? '',
      accountName: row['Account__r.Name'] ?? '',
      accountOwner: row['Account__r.Owner.Name'] ?? '',
    };
    index[domain] = record;
  }

  return {
    index,
    rowCount: result.data.length,
    uniqueDomains: Object.keys(index).length,
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
      uniqueDomains: 0,
      skippedRows: 0,
      error: `Missing required columns: ${missingColumns.join(', ')}. Found: ${foundColumns.join(', ')}`,
    };
  }

  if (result.data.length === 0) {
    return { index: {}, rowCount: 0, uniqueDomains: 0, skippedRows: 0, error: 'CSV contains no data rows' };
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
    uniqueDomains: Object.keys(index).length,
    skippedRows,
  };
}
