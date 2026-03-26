import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import fs from 'fs';
import { buildSheet15Index, buildOptOutIndex } from '../../src/lib/indexer.js';
import { readDataJSON, writeDataJSON } from '../lib/readData.js';
import type { ReferenceStatus } from '../../src/lib/types.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const type = req.query['type'];
  if (type !== 'sheet15' && type !== 'optout') {
    return res.status(400).json({ error: 'Invalid type parameter. Must be sheet15 or optout.' });
  }

  const form = formidable({ maxFileSize: 100 * 1024 * 1024, uploadDir: '/tmp' });
  let files: formidable.Files;
  try {
    [, files] = await form.parse(req);
  } catch (err) {
    return res.status(400).json({ error: `Failed to parse form data: ${String(err)}` });
  }

  const fileField = files['file'];
  const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;
  if (!uploadedFile) {
    return res.status(400).json({ error: 'No file provided' });
  }

  let csvText: string;
  try {
    csvText = fs.readFileSync(uploadedFile.filepath, 'utf-8');
  } catch (err) {
    return res.status(500).json({ error: `Failed to read uploaded file: ${String(err)}` });
  }

  try {
    const parseResult = type === 'sheet15' ? buildSheet15Index(csvText) : buildOptOutIndex(csvText);

    if (parseResult.error) {
      return res.status(400).json({ error: parseResult.error });
    }

    const blobKey = type === 'sheet15' ? 'sheet15-index.json' : 'optout-index.json';
    writeDataJSON(blobKey, parseResult.index);

    const meta = readDataJSON<ReferenceStatus>('metadata.json') ?? {
      sheet15: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
      optout:  { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
    };
    meta[type] = {
      loaded: true,
      rowCount: parseResult.rowCount,
      uniqueDomains: parseResult.uniqueDomains,
      lastUpdated: new Date().toISOString(),
    };
    writeDataJSON('metadata.json', meta);

    return res.status(200).json({
      success: true,
      rowCount: parseResult.rowCount,
      uniqueDomains: parseResult.uniqueDomains,
      skippedRows: parseResult.skippedRows,
    });
  } catch (err) {
    return res.status(500).json({ error: `Processing failed: ${String(err)}` });
  }
}
