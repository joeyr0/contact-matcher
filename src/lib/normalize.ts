const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'proton.me', 'zoho.com',
  'ymail.com', 'gmx.com', 'fastmail.com', 'tutanota.com', 'live.com',
  'msn.com', 'me.com', 'mac.com',
]);

export function normalizeDomain(input: string): string {
  if (!input || typeof input !== 'string') return '';
  let d = input.trim().toLowerCase();
  // Remove protocol
  d = d.replace(/^https?:\/\//, '');
  // Remove www. prefix
  d = d.replace(/^www\./, '');
  // Remove path (everything after first /)
  const slashIdx = d.indexOf('/');
  if (slashIdx !== -1) d = d.slice(0, slashIdx);
  // Remove port number
  d = d.replace(/:\d+$/, '');
  // Remove trailing dots
  d = d.replace(/\.+$/, '');
  return d;
}

export function isGenericDomain(domain: string): boolean {
  return GENERIC_DOMAINS.has(domain);
}

/** Split comma-separated domains, normalize each, filter empty */
export function parseMultiDomain(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => normalizeDomain(s.trim()))
    .filter((d) => d.length > 0);
}
