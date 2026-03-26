import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { buildDomainLookup, getFastCandidates, rankAndLimitCandidates, buildFuzzyPrompt, parseFuzzyResponse } from '../src/lib/fuzzy.js';
import type { DomainLookup } from '../src/lib/fuzzy.js';
import { matchByName, buildAccountNameIndex } from '../src/lib/matcher.js';
import { matchDomain } from '../src/lib/matcher.js';
import { readDataJSON } from './lib/readData.js';
import type { Sheet15Index, OptOutIndex, FuzzyBatchResult } from '../src/lib/types.js';

// Module-level caches — survive across warm invocations on the same Lambda instance
let _domainLookupCache: DomainLookup | null = null;
let _accountNameIndexCache: Map<string, string> | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { domains } = req.body as { domains?: unknown };
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: 'domains must be a non-empty array' });
  }

  const validDomains = domains.filter((d): d is string => typeof d === 'string' && d.length > 0);

  const sheet15Index = readDataJSON<Sheet15Index>('sheet15-index.json');
  const optOutIndex = readDataJSON<OptOutIndex>('optout-index.json');
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
    const nameMatch = matchByName(domain, _accountNameIndexCache, sheet15Index, optOutIndex);
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
  // Tier 2: LLM fuzzy matching for remaining unmatched domains
  // ---------------------------------------------------------------------------
  if (!_domainLookupCache) {
    _domainLookupCache = buildDomainLookup(Object.keys(sheet15Index));
  }
  const rawCandidates = getFastCandidates(needsLLM, _domainLookupCache);
  const candidates = rankAndLimitCandidates(needsLLM, rawCandidates, 200);

  if (candidates.length === 0) {
    return res.status(200).json({ matches: validatedMatches, failedDomains: needsLLM } as FuzzyBatchResult);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured.' });
  }

  const client = new OpenAI({ apiKey });
  const { system, user } = buildFuzzyPrompt(needsLLM, candidates);

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
      failedDomains: needsLLM,
      error: `LLM call failed: ${String(err)}`,
    } as FuzzyBatchResult);
  }

  const { matches: llmMatches } = parseFuzzyResponse(responseText);

  for (const { unmatchedDomain, matchedDomain, confidence } of llmMatches) {
    if (!sheet15Index[matchedDomain]) {
      console.warn(`[fuzzy] Hallucination: ${unmatchedDomain} → ${matchedDomain}`);
      continue;
    }
    const base = matchDomain(matchedDomain, sheet15Index, optOutIndex);
    validatedMatches[unmatchedDomain] = { ...base, matchMethod: 'fuzzy', matchConfidence: confidence };
    matched.add(unmatchedDomain);
  }

  return res.status(200).json({
    matches: validatedMatches,
    failedDomains: validDomains.filter((d) => !matched.has(d)),
  } as FuzzyBatchResult);
}
