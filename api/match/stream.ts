import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import fs from 'fs';
import { parseContactCSV } from '../../src/lib/csv.js';
import { normalizeDomain } from '../../src/lib/normalize.js';
import { extractDomain, matchDomain } from '../../src/lib/matcher.js';
import { readDataJSON } from '../lib/readData.js';
import type { Sheet15Index, OptOutIndex, EnrichedRow } from '../../src/lib/types.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = formidable({ maxFileSize: 50 * 1024 * 1024, uploadDir: '/tmp' });
  let csvText: string;
  let columnMode = 'auto';
  try {
    const [fields, files] = await form.parse(req);
    const fileField = files['file'];
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;
    if (!uploadedFile) return res.status(400).json({ error: 'No file provided' });
    csvText = fs.readFileSync(uploadedFile.filepath, 'utf-8');
    const modeField = fields['columnMode'];
    if (modeField) columnMode = Array.isArray(modeField) ? (modeField[0] ?? 'auto') : modeField;
  } catch (err) {
    return res.status(400).json({ error: `Failed to parse upload: ${String(err)}` });
  }

  const parsed = parseContactCSV(csvText);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  if (columnMode === 'email') parsed.isDomainColumn = false;
  if (columnMode === 'website') parsed.isDomainColumn = true;

  const sheet15Index = readDataJSON<Sheet15Index>('sheet15-index.json');
  const optOutIndex = readDataJSON<OptOutIndex>('optout-index.json');
  if (!sheet15Index || !optOutIndex) {
    return res.status(503).json({ error: 'Reference data not available. Contact your admin.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const { headers, rows, emailColIdx, isDomainColumn, companyColIdx } = parsed;
  const results: EnrichedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawValue = (row[emailColIdx] ?? '').trim();
    const domain = isDomainColumn ? normalizeDomain(rawValue) : extractDomain(rawValue);
    const companyName = companyColIdx >= 0 ? (row[companyColIdx] ?? '').trim() : '';
    const match = matchDomain(domain, sheet15Index, optOutIndex);
    results.push({ originalRow: row, domain, companyName, match });

    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      send({ type: 'progress', processed: i + 1, total: rows.length });
    }
  }

  send({ type: 'complete', headers, results });
  res.end();
}
