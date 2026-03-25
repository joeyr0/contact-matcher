import Papa from 'papaparse';

export interface ParsedContactCSV {
  headers: string[];
  rows: string[][];
  emailColIdx: number;
  /** If true, the detected column contains domains/URLs directly (not emails) */
  isDomainColumn: boolean;
  error?: string;
}

const EMAIL_HEADER_NAMES = new Set([
  'email',
  'e-mail',
  'email_address',
  'emailaddress',
  'email address',
]);

const DOMAIN_HEADER_NAMES = new Set([
  'website',
  'web site',
  'website_url',
  'url',
  'domain',
  'company website',
  'company_website',
  'company url',
  'company_url',
]);

export function parseContactCSV(csvText: string): ParsedContactCSV {
  const result = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: true,
  });

  if (result.data.length === 0) {
    return { headers: [], rows: [], emailColIdx: -1, isDomainColumn: false, error: 'CSV is empty' };
  }

  const headers = result.data[0] as string[];
  const rows = result.data.slice(1) as string[][];

  if (rows.length === 0) {
    return { headers, rows, emailColIdx: -1, isDomainColumn: false, error: 'CSV contains no data rows' };
  }

  // Step 1: email header match
  let emailColIdx = headers.findIndex((h) => EMAIL_HEADER_NAMES.has(h.toLowerCase().trim()));
  if (emailColIdx !== -1) return { headers, rows, emailColIdx, isDomainColumn: false };

  // Step 2: domain/website header match
  const domainColIdx = headers.findIndex((h) => DOMAIN_HEADER_NAMES.has(h.toLowerCase().trim()));
  if (domainColIdx !== -1) return { headers, rows, emailColIdx: domainColIdx, isDomainColumn: true };

  // Step 3: scan first 10 rows for @ signs (email column)
  const sample = rows.slice(0, 10);
  for (let colIdx = 0; colIdx < headers.length; colIdx++) {
    const atCount = sample.filter((row) => row[colIdx]?.includes('@')).length;
    if (sample.length > 0 && atCount / sample.length > 0.8) {
      return { headers, rows, emailColIdx: colIdx, isDomainColumn: false };
    }
  }

  // Step 4: scan for a column that looks like URLs/domains (contains dots, no @)
  for (let colIdx = 0; colIdx < headers.length; colIdx++) {
    const dotCount = sample.filter(
      (row) => row[colIdx]?.includes('.') && !row[colIdx]?.includes('@'),
    ).length;
    if (sample.length > 0 && dotCount / sample.length > 0.8) {
      return { headers, rows, emailColIdx: colIdx, isDomainColumn: true };
    }
  }

  return {
    headers,
    rows,
    emailColIdx: -1,
    isDomainColumn: false,
    error:
      'Could not detect an email or website column. Add a column header like "email", "website", or "domain".',
  };
}
