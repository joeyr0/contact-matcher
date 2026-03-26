import { normalizeDomain } from './normalize.js';

/**
 * Follow HTTP redirects for a domain and return the final normalized domain
 * if it differs from the input. Returns null on timeout, error, or no redirect.
 */
export async function checkRedirect(domain: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`https://${domain}`, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
      });
      const finalDomain = normalizeDomain(res.url);
      if (finalDomain && finalDomain !== domain) {
        return finalDomain;
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // timeout, DNS failure, connection refused — skip
  }
  return null;
}

/**
 * Run redirect checks on multiple domains in parallel.
 * Returns a map of domain → redirected domain (only entries that differ).
 */
export async function checkRedirects(domains: string[]): Promise<Map<string, string>> {
  const results = await Promise.all(
    domains.map(async (domain) => ({ domain, redirected: await checkRedirect(domain) })),
  );
  const map = new Map<string, string>();
  for (const { domain, redirected } of results) {
    if (redirected) map.set(domain, redirected);
  }
  return map;
}
