import Papa from 'papaparse';

export interface ParsedContactCSV {
  headers: string[];
  rows: string[][];
  emailColIdx: number;
  error?: string;
}

const EMAIL_HEADER_NAMES = new Set([
  'email',
  'e-mail',
  'email_address',
  'emailaddress',
  'email address',
]);

export function parseContactCSV(csvText: string): ParsedContactCSV {
  const result = Papa.parse<string[]>(csvText, {
    header: false,
    skipEmptyLines: true,
  });

  if (result.data.length === 0) {
    return { headers: [], rows: [], emailColIdx: -1, error: 'CSV is empty' };
  }

  const headers = result.data[0] as string[];
  const rows = result.data.slice(1) as string[][];

  if (rows.length === 0) {
    return { headers, rows, emailColIdx: -1, error: 'CSV contains no data rows' };
  }

  // Step 1: header name match
  let emailColIdx = headers.findIndex((h) =>
    EMAIL_HEADER_NAMES.has(h.toLowerCase().trim()),
  );

  // Step 2: scan first 10 rows for column where >80% of values contain @
  if (emailColIdx === -1) {
    const sample = rows.slice(0, 10);
    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      const atCount = sample.filter((row) => row[colIdx]?.includes('@')).length;
      if (sample.length > 0 && atCount / sample.length > 0.8) {
        emailColIdx = colIdx;
        break;
      }
    }
  }

  if (emailColIdx === -1) {
    return {
      headers,
      rows,
      emailColIdx: -1,
      error:
        'Could not detect email column. Please ensure your CSV has an "email" header or a column where most values contain "@".',
    };
  }

  return { headers, rows, emailColIdx };
}
