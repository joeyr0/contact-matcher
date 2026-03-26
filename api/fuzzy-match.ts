import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import { buildDomainLookup, getFastCandidates, rankAndLimitCandidates, buildFuzzyPrompt, parseFuzzyResponse } from '../src/lib/fuzzy.js';
import type { DomainLookup } from '../src/lib/fuzzy.js';
import { matchDomain } from '../src/lib/matcher.js';
import { readDataJSON } from './lib/readData.js';
import type { Sheet15Index, OptOutIndex, FuzzyBatchResult } from '../src/lib/types.js';

// Module-level cache — survives across warm invocations on the same Lambda instance
let _domainLookupCache: DomainLookup | null = null;

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

  if (!_domainLookupCache) {
    _domainLookupCache = buildDomainLookup(Object.keys(sheet15Index));
  }
  const rawCandidates = getFastCandidates(validDomains, _domainLookupCache);
  const candidates = rankAndLimitCandidates(validDomains, rawCandidates, 200);

  if (candidates.length === 0) {
    return res.status(200).json({ matches: {}, failedDomains: validDomains } as FuzzyBatchResult);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured.' });
  }

  const client = new OpenAI({ apiKey });
  const { system, user } = buildFuzzyPrompt(validDomains, candidates);

  let responseText = '';
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completion = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 1024,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        });
        responseText = completion.choices[0]?.message?.content ?? '';
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
      }
    }
  } catch (err) {
    return res.status(200).json({
      matches: {},
      failedDomains: validDomains,
      error: `LLM call failed: ${String(err)}`,
    } as FuzzyBatchResult);
  }

  const { matches: llmMatches } = parseFuzzyResponse(responseText);
  const validatedMatches: FuzzyBatchResult['matches'] = {};
  const matched = new Set<string>();

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
