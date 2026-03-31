import Papa from 'papaparse';

export interface ParsedContactCSV {
  headers: string[];
  rows: string[][];
  emailColIdx: number;
  /** If true, the detected column contains domains/URLs directly (not emails) */
  isDomainColumn: boolean;
  /** Index of the company/organization name column, -1 if not found */
  companyColIdx: number;
  error?: string;
}

const EMAIL_HEADER_NAMES = new Set([
  'email',
  'e-mail',
  'email_address',
  'emailaddress',
  'email address',
  'emails',
  'work email',
  'work_email',
  'business email',
  'contact email',
  'mail',
  'email id',
  'email_id',
]);

const COMPANY_HEADER_NAMES = new Set([
  'company',
  'company name',
  'company_name',
  'companyname',
  'organization',
  'organisation',
  'org',
  'account',
  'account name',
  'account_name',
  'employer',
  'firm',
  'business',
  'business name',
]);

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ');
}

function isCompanyHeader(header: string): boolean {
  const normalized = normalizeHeader(header);
  if (COMPANY_HEADER_NAMES.has(normalized)) return true;

  return (
    normalized.includes('company') ||
    normalized.includes('organization') ||
    normalized.includes('organisation') ||
    normalized.includes('employer') ||
    normalized.includes('where do you work') ||
    normalized.includes('work for')
  );
}

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
  'web',
  'site',
  'homepage',
  'company domain',
  'company_domain',
  'domains',
  'websites',
  'urls',
]);

function sanitizeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();

  return headers.map((header, index) => {
    const trimmed = header.trim();
    const base = trimmed || `Column ${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

export function parseContactCSV(csvText: string): ParsedContactCSV {
  const result = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: true,
  });

  if (result.data.length === 0) {
    return { headers: [], rows: [], emailColIdx: -1, isDomainColumn: false, companyColIdx: -1, error: 'CSV is empty' };
  }

  // Find the real header row — some exports (e.g. Google Sheets) have metadata rows
  // at the top before the actual column headers. Scan up to 5 rows to find one that
  // contains a known email or domain header word.
  let headerRowIdx = 0;
  const allRows = result.data as string[][];
  for (let i = 0; i < Math.min(5, allRows.length); i++) {
    const row = allRows[i];
    const hasEmailHeader = row.some((cell) => EMAIL_HEADER_NAMES.has(cell.toLowerCase().trim()));
    const hasDomainHeader = row.some((cell) => DOMAIN_HEADER_NAMES.has(cell.toLowerCase().trim()));
    if (hasEmailHeader || hasDomainHeader) {
      headerRowIdx = i;
      break;
    }
  }

  const rawHeaders = allRows[headerRowIdx] as string[];
  const headers = sanitizeHeaders(rawHeaders);
  const rows = allRows.slice(headerRowIdx + 1) as string[][];

  if (rows.length === 0) {
    return { headers, rows, emailColIdx: -1, isDomainColumn: false, companyColIdx: -1, error: 'CSV contains no data rows' };
  }

  const companyColIdx = rawHeaders.findIndex((h) => isCompanyHeader(h));

  // Step 1: email header match
  let emailColIdx = rawHeaders.findIndex((h) => EMAIL_HEADER_NAMES.has(h.toLowerCase().trim()));
  if (emailColIdx !== -1) return { headers, rows, emailColIdx, isDomainColumn: false, companyColIdx };

  // Step 2: domain/website header match
  const domainColIdx = rawHeaders.findIndex((h) => DOMAIN_HEADER_NAMES.has(h.toLowerCase().trim()));
  if (domainColIdx !== -1) return { headers, rows, emailColIdx: domainColIdx, isDomainColumn: true, companyColIdx };

  // Step 3: scan first 10 rows for @ signs (email column)
  const sample = rows.slice(0, 10);
  for (let colIdx = 0; colIdx < headers.length; colIdx++) {
    const atCount = sample.filter((row) => row[colIdx]?.includes('@')).length;
    if (sample.length > 0 && atCount / sample.length > 0.5) {
      return { headers, rows, emailColIdx: colIdx, isDomainColumn: false, companyColIdx };
    }
  }

  // Step 4: scan for a column that looks like URLs/domains (contains dots, no @)
  for (let colIdx = 0; colIdx < headers.length; colIdx++) {
    const dotCount = sample.filter(
      (row) => row[colIdx]?.includes('.') && !row[colIdx]?.includes('@'),
    ).length;
    if (sample.length > 0 && dotCount / sample.length > 0.5) {
      return { headers, rows, emailColIdx: colIdx, isDomainColumn: true, companyColIdx };
    }
  }

  return {
    headers,
    rows,
    emailColIdx: -1,
    isDomainColumn: false,
    companyColIdx,
    error:
      'Could not detect an email or website column. Add a column header like "email", "website", or "domain".',
  };
}
