import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import formidable from 'formidable';
import OpenAI from 'openai';

import { buildSheet15Index, buildOptOutIndex } from '../src/lib/indexer.js';
import { parseContactCSV } from '../src/lib/csv.js';
import { normalizeDomain } from '../src/lib/normalize.js';
import { extractDomain, matchDomain } from '../src/lib/matcher.js';
import { buildDomainLookup, getFastCandidates, buildFuzzyPrompt, parseFuzzyResponse } from '../src/lib/fuzzy.js';
import type { DomainLookup } from '../src/lib/fuzzy.js';
import type { Sheet15Index, OptOutIndex, EnrichedRow, FuzzyBatchResult } from '../src/lib/types.js';

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
let _domainLookupCache: DomainLookup | null = null;

function getSheet15Index(): Sheet15Index | null {
  if (!_sheet15Cache) _sheet15Cache = readJSON<Sheet15Index>('sheet15-index.json');
  return _sheet15Cache;
}

function getOptOutIndex(): OptOutIndex | null {
  if (!_optOutCache) _optOutCache = readJSON<OptOutIndex>('optout-index.json');
  return _optOutCache;
}

function getDomainLookup(): DomainLookup | null {
  if (!_domainLookupCache) {
    const idx = getSheet15Index();
    if (idx) _domainLookupCache = buildDomainLookup(Object.keys(idx));
  }
  return _domainLookupCache;
}

function invalidateCache() {
  _sheet15Cache = null;
  _optOutCache = null;
  _domainLookupCache = null;
}

// Pre-warm cache at startup so first request is fast
getSheet15Index();
getOptOutIndex();
getDomainLookup();

// ---------------------------------------------------------------------------
// POST /api/reference/upload?type=sheet15|optout
// ---------------------------------------------------------------------------

app.post('/api/reference/upload', (req, res) => {
  const type = req.query['type'];
  if (type !== 'sheet15' && type !== 'optout') {
    res.status(400).json({ error: 'Invalid type. Must be sheet15 or optout.' });
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

    const parseResult = type === 'sheet15' ? buildSheet15Index(csvText) : buildOptOutIndex(csvText);

    if (parseResult.error) {
      res.status(400).json({ error: parseResult.error });
      return;
    }

    const blobKey = type === 'sheet15' ? 'sheet15-index.json' : 'optout-index.json';
    writeJSON(blobKey, parseResult.index);
    invalidateCache();

    const existing = readJSON<Record<string, unknown>>('metadata.json') ?? {};
    (existing as Record<string, unknown>)[type] = {
      loaded: true,
      rowCount: parseResult.rowCount,
      uniqueDomains: parseResult.uniqueDomains,
      lastUpdated: new Date().toISOString(),
    };
    writeJSON('metadata.json', existing);

    res.json({
      success: true,
      rowCount: parseResult.rowCount,
      uniqueDomains: parseResult.uniqueDomains,
      skippedRows: parseResult.skippedRows,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/reference/status
// ---------------------------------------------------------------------------

app.get('/api/reference/status', (_req, res) => {
  const meta = readJSON('metadata.json') ?? {
    sheet15: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
    optout: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
  };
  res.json(meta);
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
    if (!sheet15Index || !optOutIndex) {
      res.status(503).json({ error: 'Reference data not loaded. Upload both CSVs first.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const { headers, rows, emailColIdx, isDomainColumn } = parsed;
    const results: EnrichedRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rawValue = (rows[i]?.[emailColIdx] ?? '').trim();
      const domain = isDomainColumn ? normalizeDomain(rawValue) : extractDomain(rawValue);
      const match = matchDomain(domain, sheet15Index, optOutIndex);
      results.push({ originalRow: rows[i] ?? [], domain, match });

      if ((i + 1) % 50 === 0 || i === rows.length - 1) {
        send({ type: 'progress', processed: i + 1, total: rows.length });
      }
    }

    send({ type: 'complete', headers, results });
    res.end();
  });
});

// ---------------------------------------------------------------------------
// POST /api/fuzzy-match
// ---------------------------------------------------------------------------

app.post('/api/fuzzy-match', async (req, res) => {
  const { domains } = req.body as { domains?: unknown };
  if (!Array.isArray(domains) || domains.length === 0) {
    res.status(400).json({ error: 'domains must be a non-empty array' });
    return;
  }

  const validDomains = domains.filter((d): d is string => typeof d === 'string' && d.length > 0);

  const sheet15Index = getSheet15Index();
  const optOutIndex = getOptOutIndex();
  if (!sheet15Index || !optOutIndex) {
    res.status(503).json({ error: 'Reference data not loaded' });
    return;
  }

  const lookup = getDomainLookup();
  if (!lookup) {
    res.status(503).json({ error: 'Reference data not loaded' });
    return;
  }
  const candidates = getFastCandidates(validDomains, lookup);

  if (candidates.length === 0) {
    const result: FuzzyBatchResult = { matches: {}, failedDomains: validDomains };
    res.json(result);
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY not set in .env' });
    return;
  }

  const client = new OpenAI({ apiKey });
  const { system, user } = buildFuzzyPrompt(validDomains, candidates);

  let responseText: string;
  try {
    let lastErr: unknown;
    responseText = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const completion = await client.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 1024,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        });
        responseText = completion.choices[0]?.message?.content ?? '';
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
      }
    }
    if (!responseText) throw lastErr;
  } catch (e) {
    const result: FuzzyBatchResult = {
      matches: {},
      failedDomains: validDomains,
      error: `LLM call failed: ${String(e)}`,
    };
    res.json(result);
    return;
  }

  const { matches: llmMatches } = parseFuzzyResponse(responseText);
  const validatedMatches: FuzzyBatchResult['matches'] = {};
  const matched = new Set<string>();

  for (const { unmatchedDomain, matchedDomain, confidence } of llmMatches) {
    if (!sheet15Index[matchedDomain]) {
      console.warn(`[fuzzy] Hallucination: ${unmatchedDomain} → ${matchedDomain} (not in index)`);
      continue;
    }
    const base = matchDomain(matchedDomain, sheet15Index, optOutIndex);
    validatedMatches[unmatchedDomain] = { ...base, matchMethod: 'fuzzy', matchConfidence: confidence };
    matched.add(unmatchedDomain);
  }

  const result: FuzzyBatchResult = {
    matches: validatedMatches,
    failedDomains: validDomains.filter((d) => !matched.has(d)),
  };
  res.json(result);
});

// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\n  API server: http://localhost:${PORT}`);
  console.log(`  Frontend:   http://localhost:5173\n`);
});
