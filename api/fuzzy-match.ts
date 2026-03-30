import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { buildDomainLookup, getFastCandidates, rankAndLimitCandidates, buildFuzzyPrompt, parseFuzzyResponse } from '../src/lib/fuzzy.js';
import { checkRedirects } from '../src/lib/redirect.js';
import type { DomainLookup } from '../src/lib/fuzzy.js';
import { matchByName, matchByCompanyName, buildAccountNameIndex, matchDomain } from '../src/lib/matcher.js';
import { readDataJSON } from './lib/readData.js';
import type { Sheet15Index, OptOutIndex, CommittedArrIndex, FuzzyBatchResult } from '../src/lib/types.js';

// Module-level caches — survive across warm invocations on the same Lambda instance
let _domainLookupCache: DomainLookup | null = null;
let _accountNameIndexCache: Map<string, string> | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { domains, companyNames: rawCompanyNames } = req.body as { domains?: unknown; companyNames?: unknown };
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: 'domains must be a non-empty array' });
  }

  const validDomains = domains.filter((d): d is string => typeof d === 'string' && d.length > 0);
  const companyNames: Record<string, string> = (rawCompanyNames && typeof rawCompanyNames === 'object' && !Array.isArray(rawCompanyNames))
    ? rawCompanyNames as Record<string, string>
    : {};

  const sheet15Index = readDataJSON<Sheet15Index>('sheet15-index.json');
  const optOutIndex = readDataJSON<OptOutIndex>('optout-index.json');
  const arrIndex = readDataJSON<CommittedArrIndex>('committed-arr-index.json');
  if (!sheet15Index || !optOutIndex) {
    return res.status(503).json({ error: 'Reference data not available.' });
  }

  // ---------------------------------------------------------------------------
  // Tier 1.5: Name-based matching — zero API calls, instant
  // ---------------------------------------------------------------------------
  if (!_accountNameIndexCache) {
    _accountNameIndexCache = buildAccountNameIndex(sheet15Index);
  }

  const validatedMatches: FuzzyBatchResult['matches'] = {};
  const matched = new Set<string>();
  const needsLLM: string[] = [];

  for (const domain of validDomains) {
    const nameMatch = matchByName(domain, _accountNameIndexCache, sheet15Index, optOutIndex, arrIndex);
    if (nameMatch) {
      validatedMatches[domain] = nameMatch;
      matched.add(domain);
    } else {
      needsLLM.push(domain);
    }
  }

  if (needsLLM.length === 0) {
    return res.status(200).json({ matches: validatedMatches, failedDomains: [] } as FuzzyBatchResult);
  }

  // ---------------------------------------------------------------------------
  // Tier 1.6: Redirect check — parallel HEAD requests, 3s timeout each
  // ---------------------------------------------------------------------------
  const redirectMap = await checkRedirects(needsLLM);
  const needsLLMAfterRedirect: string[] = [];
  for (const domain of needsLLM) {
    const redirectedDomain = redirectMap.get(domain);
    if (redirectedDomain) {
      const base = matchDomain(redirectedDomain, sheet15Index, optOutIndex, arrIndex);
      if (base.matchMethod !== 'no_match') {
        validatedMatches[domain] = { ...base, matchMethod: 'redirect', matchConfidence: 'high' };
        matched.add(domain);
        continue;
      }
    }
    needsLLMAfterRedirect.push(domain);
  }

  if (needsLLMAfterRedirect.length === 0) {
    return res.status(200).json({ matches: validatedMatches, failedDomains: [] } as FuzzyBatchResult);
  }

  // ---------------------------------------------------------------------------
  // Tier 1.7: Company name matching — explicit company name from contact row
  // e.g. company = "Accenture" → nameIndex["accenture"] = "accenture.com" → medium confidence
  // ---------------------------------------------------------------------------
  const needsLLMAfterCompany: string[] = [];
  for (const domain of needsLLMAfterRedirect) {
    const companyName = companyNames[domain] ?? '';
    if (companyName && _accountNameIndexCache) {
      const companyMatch = matchByCompanyName(companyName, _accountNameIndexCache, sheet15Index, optOutIndex, arrIndex);
      if (companyMatch) {
        validatedMatches[domain] = companyMatch;
        matched.add(domain);
        continue;
      }
    }
    needsLLMAfterCompany.push(domain);
  }

  if (needsLLMAfterCompany.length === 0) {
    return res.status(200).json({ matches: validatedMatches, failedDomains: [] } as FuzzyBatchResult);
  }

  // ---------------------------------------------------------------------------
  // Tier 2: LLM fuzzy matching for remaining unmatched domains
  // ---------------------------------------------------------------------------
  if (!_domainLookupCache) {
    _domainLookupCache = buildDomainLookup(Object.keys(sheet15Index));
  }
  const rawCandidates = getFastCandidates(needsLLMAfterCompany, _domainLookupCache);
  const candidates = rankAndLimitCandidates(needsLLMAfterCompany, rawCandidates, 200);

  if (candidates.length === 0) {
    return res.status(200).json({ matches: validatedMatches, failedDomains: needsLLMAfterCompany } as FuzzyBatchResult);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured.' });
  }

  const client = new OpenAI({ apiKey });
  const { system, user } = buildFuzzyPrompt(needsLLMAfterCompany, candidates);

  let responseText = '';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const completion = await client.chat.completions.create(
        { model: 'gpt-4o-mini', max_tokens: 1024, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
        { signal: controller.signal },
      );
      responseText = completion.choices[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    return res.status(200).json({
      matches: validatedMatches,
      failedDomains: needsLLMAfterCompany,
      error: `LLM call failed: ${String(err)}`,
    } as FuzzyBatchResult);
  }

  const { matches: llmMatches } = parseFuzzyResponse(responseText);

  for (const { unmatchedDomain, matchedDomain, confidence } of llmMatches) {
    if (!sheet15Index[matchedDomain]) {
      console.warn(`[fuzzy] Hallucination: ${unmatchedDomain} → ${matchedDomain}`);
      continue;
    }
    const base = matchDomain(matchedDomain, sheet15Index, optOutIndex, arrIndex);
    validatedMatches[unmatchedDomain] = { ...base, matchMethod: 'fuzzy', matchConfidence: confidence };
    matched.add(unmatchedDomain);
  }

  return res.status(200).json({
    matches: validatedMatches,
    failedDomains: needsLLMAfterCompany.filter((d) => !matched.has(d)),
  } as FuzzyBatchResult);
}
