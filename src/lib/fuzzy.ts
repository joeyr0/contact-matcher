import { normalizeDomain } from './normalize';

// ---------------------------------------------------------------------------
// Fast candidate lookup — O(1) per domain via pre-built indexes
// ---------------------------------------------------------------------------

export interface DomainLookup {
  byTld: Map<string, string[]>;      // '.io' -> ['company.io', ...]
  byPrefix: Map<string, string[]>;   // 'hel' -> ['hello.com', ...]  (first 3 chars of root)
}

/** Build once at startup from the Sheet15 reference domain list. */
export function buildDomainLookup(domains: string[]): DomainLookup {
  const byTld = new Map<string, string[]>();
  const byPrefix = new Map<string, string[]>();

  for (const d of domains) {
    const dot = d.lastIndexOf('.');
    const tld = dot !== -1 ? d.slice(dot) : '';
    const root = dot !== -1 ? d.slice(0, dot) : d;
    const prefix = root.slice(0, 3).toLowerCase();

    let tldList = byTld.get(tld);
    if (!tldList) { tldList = []; byTld.set(tld, tldList); }
    tldList.push(d);

    let pfxList = byPrefix.get(prefix);
    if (!pfxList) { pfxList = []; byPrefix.set(prefix, pfxList); }
    pfxList.push(d);
  }

  return { byTld, byPrefix };
}

/**
 * Fast candidate finder using pre-built TLD + prefix indexes.
 * No per-domain iteration over the full 18k list — just two hash lookups.
 */
export function getFastCandidates(
  unmatchedDomains: string[],
  lookup: DomainLookup,
): string[] {
  const candidates = new Set<string>();

  for (const domain of unmatchedDomains) {
    const dot = domain.lastIndexOf('.');
    const tld = dot !== -1 ? domain.slice(dot) : '';
    const root = dot !== -1 ? domain.slice(0, dot) : domain;

    // All domains with the same TLD
    for (const d of lookup.byTld.get(tld) ?? []) candidates.add(d);

    // All domains sharing the first 3 chars of their root
    const prefix3 = root.slice(0, 3).toLowerCase();
    for (const d of lookup.byPrefix.get(prefix3) ?? []) candidates.add(d);

    // Also try 2-char prefix for short roots
    if (root.length >= 2) {
      const prefix2 = root.slice(0, 2).toLowerCase();
      for (const d of lookup.byPrefix.get(prefix2) ?? []) candidates.add(d);
    }
  }

  return Array.from(candidates);
}

/** @deprecated Use buildDomainLookup + getFastCandidates instead. Kept for tests. */
export function getNgramCandidates(
  unmatchedDomains: string[],
  allReferenceDomains: string[],
): string[] {
  const lookup = buildDomainLookup(allReferenceDomains);
  return getFastCandidates(unmatchedDomains, lookup);
}

/**
 * Score a reference candidate against a single unmatched domain.
 * Higher = more likely to be the same company.
 *
 * Key insight: blockaid.co vs blockaid.io → same root → score 100.
 * Domains just sharing a TLD or 2-char prefix score much lower.
 */
function scoreCandidate(candidate: string, domain: string): number {
  const cDot = candidate.lastIndexOf('.');
  const dDot = domain.lastIndexOf('.');
  const cRoot = cDot !== -1 ? candidate.slice(0, cDot) : candidate;
  const dRoot = dDot !== -1 ? domain.slice(0, dDot) : domain;
  const cTld  = cDot !== -1 ? candidate.slice(cDot) : '';
  const dTld  = dDot !== -1 ? domain.slice(dDot) : '';

  let score = 0;

  if (cRoot === dRoot) {
    // Identical root (blockaid.io → blockaid.co) — very strong signal
    score += 100;
  } else if (cRoot.length >= 4 && dRoot.length >= 4) {
    if (dRoot.includes(cRoot) || cRoot.includes(dRoot)) {
      // One root contains the other (e.g., "thecompany" vs "company")
      score += 55;
    } else {
      // Longest common prefix of roots
      let lcp = 0;
      while (lcp < cRoot.length && lcp < dRoot.length && cRoot[lcp] === dRoot[lcp]) lcp++;
      score += lcp * 8;
    }
  }

  // Same TLD is a weak bonus (avoids drowning out same-root cross-TLD matches)
  if (cTld === dTld) score += 3;

  return score;
}

/**
 * Rank candidates by how similar they are to any domain in the batch,
 * then return the top maxCount. This ensures high-signal candidates
 * (e.g., blockaid.co when matching blockaid.io) float to the top of
 * the LLM prompt instead of being buried in a flat list of 500+ entries.
 */
export function rankAndLimitCandidates(
  unmatchedDomains: string[],
  candidates: string[],
  maxCount = 200,
): string[] {
  // O(candidates × batch_size) — typically 500 × 20 = 10,000 ops, negligible
  const scored = candidates.map((c) => {
    let best = 0;
    for (const d of unmatchedDomains) {
      const s = scoreCandidate(c, d);
      if (s > best) best = s;
    }
    return { c, best };
  });
  scored.sort((a, b) => b.best - a.best);
  return scored.slice(0, maxCount).map((x) => x.c);
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a domain matching assistant. You will receive a list of unmatched domains and a list of reference domains from a company database.

Your job: For each unmatched domain, determine if any reference domain belongs to the same company/project.

Match types to look for:
- Same brand, different TLD (e.g., companyname.io vs companyname.com)
- Brand name in different format (e.g., thecompany.com vs company.co)
- Known subsidiaries or product domains (e.g., roninchain.com → skymavis.com)
- Common crypto naming patterns (e.g., protocol.finance → protocol.xyz)

Rules:
- ONLY suggest matches from the reference domain list provided
- NEVER invent or guess domains not in the reference list
- If unsure, do NOT suggest a match — false positives are worse than missed matches
- Rate your confidence: "medium" (same brand, different TLD) or "low" (inferred relationship)

Respond with ONLY a JSON array, no markdown, no explanation:
[
  {
    "unmatched_domain": "example.trade",
    "matched_domain": "example.xyz",
    "confidence": "medium",
    "reasoning": "Same brand name 'example', different TLD"
  }
]

If no matches found for any domain, return an empty array: []`;

export function buildFuzzyPrompt(
  unmatchedDomains: string[],
  candidateDomains: string[],
): { system: string; user: string } {
  const user = [
    'REFERENCE DOMAINS (pre-filtered candidates):',
    candidateDomains.join(', '),
    '',
    'UNMATCHED DOMAINS:',
    unmatchedDomains.map((d, i) => `${i + 1}. ${d}`).join('\n'),
  ].join('\n');

  return { system: SYSTEM_PROMPT, user };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export interface ParsedFuzzyResponse {
  matches: Array<{ unmatchedDomain: string; matchedDomain: string; confidence: 'medium' | 'low'; reasoning: string }>;
  parseError?: string;
}

export function parseFuzzyResponse(responseText: string): ParsedFuzzyResponse {
  // Strip markdown code fences if present
  const cleaned = responseText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { matches: [], parseError: `JSON parse failed: ${cleaned.slice(0, 200)}` };
  }

  if (!Array.isArray(parsed)) {
    return { matches: [], parseError: 'LLM response was not an array' };
  }

  const matches: ParsedFuzzyResponse['matches'] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const raw = item as Record<string, unknown>;

    const unmatchedDomain = typeof raw['unmatched_domain'] === 'string' ? raw['unmatched_domain'] : null;
    const matchedDomain = typeof raw['matched_domain'] === 'string' ? raw['matched_domain'] : null;
    const confidence = raw['confidence'] === 'medium' ? 'medium' : raw['confidence'] === 'low' ? 'low' : null;
    const reasoning = typeof raw['reasoning'] === 'string' ? raw['reasoning'] : '';

    if (!unmatchedDomain || !matchedDomain || !confidence) continue;

    // Guard: LLM should not match a domain to itself
    if (normalizeDomain(unmatchedDomain) === normalizeDomain(matchedDomain)) continue;

    matches.push({
      unmatchedDomain: normalizeDomain(unmatchedDomain),
      matchedDomain: normalizeDomain(matchedDomain),
      confidence,
      reasoning,
    });
  }

  return { matches };
}
