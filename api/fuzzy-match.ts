import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list } from '@vercel/blob';
import OpenAI from 'openai';
import { getNgramCandidates, buildFuzzyPrompt, parseFuzzyResponse } from '../src/lib/fuzzy';
import { matchDomain } from '../src/lib/matcher';
import type { Sheet15Index, OptOutIndex, FuzzyBatchResult } from '../src/lib/types';

async function loadBlobJSON<T>(blobName: string): Promise<T> {
  const { blobs } = await list({
    prefix: blobName,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (!blobs.length) throw new Error(`${blobName} not found — upload reference data first`);
  const res = await fetch(blobs[0].url);
  if (!res.ok) throw new Error(`Failed to fetch ${blobName}`);
  return res.json() as Promise<T>;
}

async function callOpenAIWithRetry(
  client: OpenAI,
  system: string,
  user: string,
  maxRetries = 3,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      return completion.choices[0]?.message?.content ?? '';
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 500));
      }
    }
  }
  throw lastError;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { domains } = req.body as { domains?: unknown };
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: 'domains must be a non-empty array' });
  }

  const validDomains = domains.filter((d): d is string => typeof d === 'string' && d.length > 0);
  if (validDomains.length === 0) {
    return res.status(400).json({ error: 'No valid domains provided' });
  }

  // Load reference indexes
  let sheet15Index: Sheet15Index;
  let optOutIndex: OptOutIndex;
  try {
    [sheet15Index, optOutIndex] = await Promise.all([
      loadBlobJSON<Sheet15Index>('sheet15-index.json'),
      loadBlobJSON<OptOutIndex>('optout-index.json'),
    ]);
  } catch (err) {
    return res.status(503).json({ error: String(err) });
  }

  const allReferenceDomains = Object.keys(sheet15Index);

  // Pre-filter candidates via n-gram similarity
  const candidates = getNgramCandidates(validDomains, allReferenceDomains);

  if (candidates.length === 0) {
    const result: FuzzyBatchResult = { matches: {}, failedDomains: validDomains };
    return res.status(200).json(result);
  }

  // Call LLM
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { system, user } = buildFuzzyPrompt(validDomains, candidates);

  let responseText: string;
  try {
    responseText = await callOpenAIWithRetry(client, system, user);
  } catch (err) {
    const result: FuzzyBatchResult = {
      matches: {},
      failedDomains: validDomains,
      error: `LLM call failed after retries: ${String(err)}`,
    };
    return res.status(200).json(result); // 200 so client can continue with next batch
  }

  // Parse LLM response
  const { matches: llmMatches, parseError } = parseFuzzyResponse(responseText);

  const validatedMatches: FuzzyBatchResult['matches'] = {};
  const failedDomains: string[] = [];

  // Track which input domains got a validated match
  const matchedInputDomains = new Set<string>();

  for (const llmMatch of llmMatches) {
    const { unmatchedDomain, matchedDomain, confidence } = llmMatch;

    // Hallucination guard: matched domain MUST exist in Sheet15 index
    if (!sheet15Index[matchedDomain]) {
      // Log discarded hallucination (server-side only)
      console.warn(`[fuzzy] Hallucination discarded: ${unmatchedDomain} → ${matchedDomain} (not in index)`);
      continue;
    }

    // Use the matched reference domain for all index lookups
    const baseMatch = matchDomain(matchedDomain, sheet15Index, optOutIndex);

    validatedMatches[unmatchedDomain] = {
      ...baseMatch,
      matchMethod: 'fuzzy',
      matchConfidence: confidence,
    };

    matchedInputDomains.add(unmatchedDomain);
  }

  // Domains that had no valid LLM match go in failedDomains
  for (const domain of validDomains) {
    if (!matchedInputDomains.has(domain)) {
      failedDomains.push(domain);
    }
  }

  const result: FuzzyBatchResult = {
    matches: validatedMatches,
    failedDomains,
    error: parseError,
  };

  return res.status(200).json(result);
}
