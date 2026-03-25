import { normalizeDomain } from './normalize';

// ---------------------------------------------------------------------------
// Character bigram similarity
// ---------------------------------------------------------------------------

function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2));
  }
  return bigrams;
}

function bigramSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigramsA = getBigrams(a);
  const bigramsB = getBigrams(b);
  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * For a batch of unmatched domains, compute the union of their top candidates
 * from the full reference domain list. Returns at most maxCandidates domains.
 */
export function getNgramCandidates(
  unmatchedDomains: string[],
  allReferenceDomains: string[],
  maxPerDomain = 300,
): string[] {
  const candidateSet = new Set<string>();

  for (const unmatched of unmatchedDomains) {
    const base = unmatched.split('.')[0]; // e.g. "haiku" from "haiku.trade"

    const scored = allReferenceDomains
      .map((ref) => ({
        ref,
        score: Math.max(
          bigramSimilarity(unmatched, ref),
          bigramSimilarity(base, ref.split('.')[0]),
        ),
      }))
      .filter(({ score }) => score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxPerDomain);

    for (const { ref } of scored) {
      candidateSet.add(ref);
    }
  }

  return Array.from(candidateSet);
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
