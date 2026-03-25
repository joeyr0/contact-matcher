import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list } from '@vercel/blob';
import formidable from 'formidable';
import fs from 'fs';
import { parseContactCSV } from '../../src/lib/csv';
import { extractDomain, matchDomain } from '../../src/lib/matcher';
import type { Sheet15Index, OptOutIndex, EnrichedRow } from '../../src/lib/types';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function loadBlobJSON<T>(blobName: string): Promise<T> {
  const { blobs } = await list({
    prefix: blobName,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (!blobs.length) throw new Error(`${blobName} not found — upload reference data first`);
  const res = await fetch(blobs[0].url);
  if (!res.ok) throw new Error(`Failed to fetch ${blobName}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function sseEvent(res: VercelResponse, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse uploaded file
  const form = formidable({ maxFileSize: 50 * 1024 * 1024 });
  let csvText: string;
  try {
    const [, files] = await form.parse(req);
    const fileField = files['file'];
    const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;
    if (!uploadedFile) return res.status(400).json({ error: 'No file provided' });
    csvText = fs.readFileSync(uploadedFile.filepath, 'utf-8');
  } catch (err) {
    return res.status(400).json({ error: `Failed to parse upload: ${String(err)}` });
  }

  // Parse contact CSV
  const parsed = parseContactCSV(csvText);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  // Load reference indexes from Vercel Blob
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

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const { headers, rows, emailColIdx } = parsed;
  const total = rows.length;
  const results: EnrichedRow[] = [];

  // Run Tier 1 matching
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawEmail = row[emailColIdx] ?? '';
    const domain = extractDomain(rawEmail.trim());
    const match = matchDomain(domain, sheet15Index, optOutIndex);

    results.push({ originalRow: row, domain, match });

    // Send progress every 50 rows and on the last row
    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      sseEvent(res, { type: 'progress', processed: i + 1, total });
    }
  }

  sseEvent(res, { type: 'complete', headers, results });
  res.end();
}
