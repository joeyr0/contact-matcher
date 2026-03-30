import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import formidable from 'formidable';
import OpenAI from 'openai';

import { buildSheet15Index, buildOptOutIndex, buildCommittedArrIndex } from '../src/lib/indexer.js';
import { parseContactCSV } from '../src/lib/csv.js';
import { normalizeDomain } from '../src/lib/normalize.js';
import { extractDomain, matchDomain, getCustomerLookup, findPossibleCustomerMatch } from '../src/lib/matcher.js';
import { hydrateScoreRows, scoreEnrichedRows } from '../src/lib/icpServer.js';
import { generateOutboundDrafts } from '../src/lib/outboundServer.js';
import { getDefaultPromptConfig, readPromptConfig, resetPromptValue, updatePromptValue } from '../src/lib/promptConfig.js';
import { buildDomainLookup, getFastCandidates, rankAndLimitCandidates, buildFuzzyPrompt, parseFuzzyResponse } from '../src/lib/fuzzy.js';
import { checkRedirects } from '../src/lib/redirect.js';
import { matchByCompanyName } from '../src/lib/matcher.js';
import type { DomainLookup } from '../src/lib/fuzzy.js';
import { matchByName, buildAccountNameIndex } from '../src/lib/matcher.js';
import type { Sheet15Index, OptOutIndex, CommittedArrIndex, EnrichedRow, FuzzyBatchResult, ReferenceStatus } from '../src/lib/types.js';
import type { OutboundCandidate } from '../src/lib/types.js';

const app = express();
const PORT = 3001;
const DATA_DIR = path.join(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dataPath(name: string) {
  return path.join(DATA_DIR, name);
}

function readJSON<T>(name: string): T | null {
  const p = dataPath(name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
}

function writeJSON(name: string, data: unknown) {
  fs.writeFileSync(dataPath(name), JSON.stringify(data), 'utf-8');
}

// ---------------------------------------------------------------------------
// In-memory index cache — loaded once at startup, invalidated on upload
// ---------------------------------------------------------------------------

let _sheet15Cache: Sheet15Index | null = null;
let _optOutCache: OptOutIndex | null = null;
let _arrCache: CommittedArrIndex | null = null;
let _domainLookupCache: DomainLookup | null = null;
let _accountNameIndexCache: Map<string, string> | null = null;

function getSheet15Index(): Sheet15Index | null {
  if (!_sheet15Cache) _sheet15Cache = readJSON<Sheet15Index>('sheet15-index.json');
  return _sheet15Cache;
}

function getOptOutIndex(): OptOutIndex | null {
  if (!_optOutCache) _optOutCache = readJSON<OptOutIndex>('optout-index.json');
  return _optOutCache;
}

function getArrIndex(): CommittedArrIndex | null {
  if (!_arrCache) _arrCache = readJSON<CommittedArrIndex>('committed-arr-index.json');
  return _arrCache;
}

function getDomainLookup(): DomainLookup | null {
  if (!_domainLookupCache) {
    const idx = getSheet15Index();
    if (idx) _domainLookupCache = buildDomainLookup(Object.keys(idx));
  }
  return _domainLookupCache;
}

function getAccountNameIndex(): Map<string, string> | null {
  if (!_accountNameIndexCache) {
    const idx = getSheet15Index();
    if (idx) _accountNameIndexCache = buildAccountNameIndex(idx);
  }
  return _accountNameIndexCache;
}

function invalidateCache() {
  _sheet15Cache = null;
  _optOutCache = null;
  _arrCache = null;
  _domainLookupCache = null;
  _accountNameIndexCache = null;
}

// Pre-warm cache at startup so first request is fast
getSheet15Index();
getOptOutIndex();
getArrIndex();
getDomainLookup();
getAccountNameIndex();

// ---------------------------------------------------------------------------
// POST /api/reference/upload?type=sheet15|optout|arr
// ---------------------------------------------------------------------------

app.post('/api/reference/upload', (req, res) => {
  const type = req.query['type'];
  if (type !== 'sheet15' && type !== 'optout' && type !== 'arr') {
    res.status(400).json({ error: 'Invalid type. Must be sheet15, optout, or arr.' });
    return;
  }

  const form = formidable({ maxFileSize: 100 * 1024 * 1024 });
  form.parse(req, (err, _fields, files) => {
    if (err) {
      res.status(400).json({ error: `Failed to parse upload: ${String(err)}` });
      return;
    }

    const fileField = files['file'];
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;
    if (!uploadedFile) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    let csvText: string;
    try {
      csvText = fs.readFileSync(uploadedFile.filepath, 'utf-8');
    } catch (e) {
      res.status(500).json({ error: `Could not read file: ${String(e)}` });
      return;
    }

    const parseResult =
      type === 'sheet15'
        ? buildSheet15Index(csvText)
        : type === 'optout'
          ? buildOptOutIndex(csvText)
          : buildCommittedArrIndex(csvText);

    if (parseResult.error) {
      res.status(400).json({ error: parseResult.error });
      return;
    }

    const blobKey = type === 'sheet15' ? 'sheet15-index.json' : type === 'optout' ? 'optout-index.json' : 'committed-arr-index.json';
    writeJSON(blobKey, parseResult.index);
    invalidateCache();

    const existing = readJSON<ReferenceStatus>('metadata.json') ?? {
      sheet15: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
      optout: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
      arr: { loaded: false, rowCount: 0, uniqueCustomers: 0, lastUpdated: null },
    };
    if (type === 'arr') {
      existing.arr = {
        loaded: true,
        rowCount: parseResult.rowCount,
        uniqueCustomers: parseResult.uniqueCount,
        lastUpdated: new Date().toISOString(),
      };
    } else {
      existing[type] = {
        loaded: true,
        rowCount: parseResult.rowCount,
        uniqueDomains: parseResult.uniqueCount,
        lastUpdated: new Date().toISOString(),
      };
    }
    writeJSON('metadata.json', existing);

    res.json({
      success: true,
      rowCount: parseResult.rowCount,
      uniqueCount: parseResult.uniqueCount,
      uniqueLabel: type === 'arr' ? 'customers' : 'domains',
      skippedRows: parseResult.skippedRows,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/reference/status
// ---------------------------------------------------------------------------

app.get('/api/reference/status', (_req, res) => {
  const meta = readJSON<ReferenceStatus>('metadata.json') ?? {
    sheet15: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
    optout: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
    arr: { loaded: false, rowCount: 0, uniqueCustomers: 0, lastUpdated: null },
  };
  res.json(meta);
});

app.get('/api/prompts', (_req, res) => {
  res.json({
    prompts: readPromptConfig(),
    defaults: getDefaultPromptConfig(),
  });
});

app.put('/api/prompts', (req, res) => {
  const { key, value } = req.body as { key?: 'icpScoring' | 'contactScoring' | 'outbound'; value?: string };
  if ((key !== 'icpScoring' && key !== 'contactScoring' && key !== 'outbound') || typeof value !== 'string') {
    res.status(400).json({ error: 'key and value are required' });
    return;
  }
  res.json({ prompts: updatePromptValue(key, value) });
});

app.post('/api/prompts', (req, res) => {
  const { key, action } = req.body as { key?: 'icpScoring' | 'contactScoring' | 'outbound'; action?: string };
  if ((key !== 'icpScoring' && key !== 'contactScoring' && key !== 'outbound') || action !== 'reset') {
    res.status(400).json({ error: 'key and action=reset are required' });
    return;
  }
  res.json({ prompts: resetPromptValue(key) });
});

// ---------------------------------------------------------------------------
// POST /api/match/stream  (SSE)
// ---------------------------------------------------------------------------

app.post('/api/match/stream', (req, res) => {
  const form = formidable({ maxFileSize: 50 * 1024 * 1024 });
  form.parse(req, (err, _fields, files) => {
    if (err) {
      res.status(400).json({ error: `Failed to parse upload: ${String(err)}` });
      return;
    }

    const fileField = files['file'];
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;
    if (!uploadedFile) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    let csvText: string;
    try {
      csvText = fs.readFileSync(uploadedFile.filepath, 'utf-8');
    } catch (e) {
      res.status(500).json({ error: String(e) });
      return;
    }

    const columnMode = (Array.isArray(_fields['columnMode']) ? _fields['columnMode'][0] : _fields['columnMode']) ?? 'auto';

    const parsed = parseContactCSV(csvText);
    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    // Override auto-detection with explicit user choice
    if (columnMode === 'email') parsed.isDomainColumn = false;
    if (columnMode === 'website') parsed.isDomainColumn = true;

    const sheet15Index = getSheet15Index();
    const optOutIndex = getOptOutIndex();
    const arrIndex = getArrIndex();
    if (!sheet15Index || !optOutIndex) {
      res.status(503).json({ error: 'Reference data not loaded. Upload both CSVs first.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const { headers, rows, emailColIdx, isDomainColumn, companyColIdx } = parsed;
    const results: EnrichedRow[] = [];
    const customerLookup = arrIndex ? getCustomerLookup(arrIndex) : null;

    for (let i = 0; i < rows.length; i++) {
      const rawValue = (rows[i]?.[emailColIdx] ?? '').trim();
      const domain = isDomainColumn ? normalizeDomain(rawValue) : extractDomain(rawValue);
      const companyName = companyColIdx >= 0 ? (rows[i]?.[companyColIdx] ?? '').trim() : '';
      const match = matchDomain(domain, sheet15Index, optOutIndex, arrIndex);

      if (
        customerLookup &&
        match.matchMethod === 'no_match' &&
        match.isActiveCustomer !== 'TRUE'
      ) {
        const possibleCustomer = findPossibleCustomerMatch(customerLookup, companyName, domain);
        if (possibleCustomer) {
          match.isCustomer = 'maybe';
          match.possibleCustomer = 'TRUE';
          match.customerMatchMethod = 'name_similarity';
          match.customerMatchConfidence = possibleCustomer.confidence;
          match.possibleCustomerConfidence = possibleCustomer.confidence;
          match.possibleCustomerReason = `${possibleCustomer.reason}: ${possibleCustomer.record.customerName}`;
          match.arrCustomerName = possibleCustomer.record.customerName;
          match.customerTier = possibleCustomer.record.customerTier;
          match.stripeSubscriptionStatus = possibleCustomer.record.subscriptionStatus;
        }
      }
      results.push({ originalRow: rows[i] ?? [], domain, companyName, match });

      if ((i + 1) % 50 === 0 || i === rows.length - 1) {
        send({ type: 'progress', processed: i + 1, total: rows.length });
      }
    }

    send({ type: 'complete', headers, results });
    res.end();
  });
});

app.post('/api/outbound/stream', async (req, res) => {
  const { candidates } = req.body as { candidates?: unknown };
  if (!Array.isArray(candidates)) {
    res.status(400).json({ error: 'candidates is a required array' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const drafts = await generateOutboundDrafts(
      candidates as OutboundCandidate[],
      (processed, total) => send({ type: 'progress', processed, total }),
    );

    send({ type: 'complete', drafts });
    res.end();
  } catch (error) {
    send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// POST /api/icp-score/stream
// ---------------------------------------------------------------------------

app.post('/api/icp-score/stream', async (req, res) => {
  const { headers, results } = req.body as { headers?: unknown; results?: unknown };
  if (!Array.isArray(headers) || !Array.isArray(results)) {
    res.status(400).json({ error: 'headers and results are required arrays' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const scored = await scoreEnrichedRows(
      headers as string[],
      hydrateScoreRows(results as any[]),
      (stage, processed, total) => send({ type: 'progress', stage, processed, total }),
    );
    send({ type: 'complete', results: scored });
    res.end();
  } catch (error) {
    send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// POST /api/fuzzy-match
// ---------------------------------------------------------------------------

app.post('/api/fuzzy-match', async (req, res) => {
  const { domains, companyNames: rawCompanyNames } = req.body as { domains?: unknown; companyNames?: unknown };
  if (!Array.isArray(domains) || domains.length === 0) {
    res.status(400).json({ error: 'domains must be a non-empty array' });
    return;
  }

  const validDomains = domains.filter((d): d is string => typeof d === 'string' && d.length > 0);
  const companyNames: Record<string, string> = (rawCompanyNames && typeof rawCompanyNames === 'object' && !Array.isArray(rawCompanyNames))
    ? rawCompanyNames as Record<string, string>
    : {};

  const sheet15Index = getSheet15Index();
  const optOutIndex = getOptOutIndex();
  const arrIndex = getArrIndex();
  if (!sheet15Index || !optOutIndex) {
    res.status(503).json({ error: 'Reference data not loaded' });
    return;
  }

  // ---------------------------------------------------------------------------
  // Tier 1.5: Name-based matching — zero API calls, instant
  // ---------------------------------------------------------------------------
  const nameIndex = getAccountNameIndex();
  const validatedMatches: FuzzyBatchResult['matches'] = {};
  const matched = new Set<string>();
  const needsLLM: string[] = [];

  if (nameIndex) {
    for (const domain of validDomains) {
      const nameMatch = matchByName(domain, nameIndex, sheet15Index, optOutIndex, arrIndex);
      if (nameMatch) {
        validatedMatches[domain] = nameMatch;
        matched.add(domain);
      } else {
        needsLLM.push(domain);
      }
    }
  } else {
    needsLLM.push(...validDomains);
  }

  // If all resolved by name matching, skip everything else
  if (needsLLM.length === 0) {
    res.json({ matches: validatedMatches, failedDomains: [] } as FuzzyBatchResult);
    return;
  }

  // ---------------------------------------------------------------------------
  // Tier 1.6: Redirect check — parallel HEAD requests, 3s timeout each
  // e.g. stakek.it → yield.xyz (in Sheet15 as StakeKit) → high confidence match
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
    res.json({ matches: validatedMatches, failedDomains: [] } as FuzzyBatchResult);
    return;
  }

  // ---------------------------------------------------------------------------
  // Tier 1.7: Company name matching
  // ---------------------------------------------------------------------------
  const needsLLMAfterCompany: string[] = [];
  for (const domain of needsLLMAfterRedirect) {
    const companyName = companyNames[domain] ?? '';
    if (companyName && nameIndex) {
      const companyMatch = matchByCompanyName(companyName, nameIndex, sheet15Index, optOutIndex, arrIndex);
      if (companyMatch) {
        validatedMatches[domain] = companyMatch;
        matched.add(domain);
        continue;
      }
    }
    needsLLMAfterCompany.push(domain);
  }

  if (needsLLMAfterCompany.length === 0) {
    res.json({ matches: validatedMatches, failedDomains: [] } as FuzzyBatchResult);
    return;
  }

  // ---------------------------------------------------------------------------
  // Tier 2: LLM fuzzy matching for remaining unmatched domains
  // ---------------------------------------------------------------------------
  const lookup = getDomainLookup();
  if (!lookup) {
    res.status(503).json({ error: 'Reference data not loaded' });
    return;
  }
  const rawCandidates = getFastCandidates(needsLLMAfterCompany, lookup);
  const candidates = rankAndLimitCandidates(needsLLMAfterCompany, rawCandidates, 200);

  if (candidates.length === 0) {
    res.json({ matches: validatedMatches, failedDomains: needsLLMAfterCompany } as FuzzyBatchResult);
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY not set in .env' });
    return;
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
  } catch (e) {
    const result: FuzzyBatchResult = {
      matches: validatedMatches,
      failedDomains: needsLLMAfterCompany,
      error: `LLM call failed: ${String(e)}`,
    };
    res.json(result);
    return;
  }

  const { matches: llmMatches } = parseFuzzyResponse(responseText);

  for (const { unmatchedDomain, matchedDomain, confidence } of llmMatches) {
    if (!sheet15Index[matchedDomain]) {
      console.warn(`[fuzzy] Hallucination: ${unmatchedDomain} → ${matchedDomain} (not in index)`);
      continue;
    }
    const base = matchDomain(matchedDomain, sheet15Index, optOutIndex, arrIndex);
    validatedMatches[unmatchedDomain] = { ...base, matchMethod: 'fuzzy', matchConfidence: confidence };
    matched.add(unmatchedDomain);
  }

  res.json({
    matches: validatedMatches,
    failedDomains: needsLLMAfterCompany.filter((d) => !matched.has(d)),
  } as FuzzyBatchResult);
});

// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\n  API server: http://localhost:${PORT}`);
  console.log(`  Frontend:   http://localhost:5173\n`);
});
