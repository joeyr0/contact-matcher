import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put, list } from '@vercel/blob';
import formidable from 'formidable';
import fs from 'fs';
import { buildSheet15Index, buildOptOutIndex } from '../../src/lib/indexer';

export const config = {
  api: {
    bodyParser: false,
  },
};

interface Metadata {
  sheet15: {
    loaded: boolean;
    rowCount: number;
    uniqueDomains: number;
    lastUpdated: string | null;
  };
  optout: {
    loaded: boolean;
    rowCount: number;
    uniqueDomains: number;
    lastUpdated: string | null;
  };
}

async function getMetadata(): Promise<Metadata> {
  const defaultMeta: Metadata = {
    sheet15: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
    optout: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
  };

  try {
    const { blobs } = await list({ prefix: 'metadata.json', token: process.env.BLOB_READ_WRITE_TOKEN });
    const metaBlob = blobs.find((b) => b.pathname === 'metadata.json');
    if (!metaBlob) return defaultMeta;
    const res = await fetch(metaBlob.url);
    if (!res.ok) return defaultMeta;
    return (await res.json()) as Metadata;
  } catch {
    return defaultMeta;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const type = req.query['type'];
  if (type !== 'sheet15' && type !== 'optout') {
    return res.status(400).json({ error: 'Invalid type parameter. Must be sheet15 or optout.' });
  }

  // Parse multipart form data
  const form = formidable({ maxFileSize: 50 * 1024 * 1024 }); // 50MB limit
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
    let parseResult;
    let blobKey: string;

    if (type === 'sheet15') {
      parseResult = buildSheet15Index(csvText);
      blobKey = 'sheet15-index.json';
    } else {
      parseResult = buildOptOutIndex(csvText);
      blobKey = 'optout-index.json';
    }

    // Validation error — do NOT write to Blob
    if (parseResult.error) {
      return res.status(400).json({ error: parseResult.error });
    }

    // Store index to Vercel Blob
    await put(blobKey, JSON.stringify(parseResult.index), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    // Update metadata
    const metadata = await getMetadata();
    const now = new Date().toISOString();
    if (type === 'sheet15') {
      metadata.sheet15 = {
        loaded: true,
        rowCount: parseResult.rowCount,
        uniqueDomains: parseResult.uniqueDomains,
        lastUpdated: now,
      };
    } else {
      metadata.optout = {
        loaded: true,
        rowCount: parseResult.rowCount,
        uniqueDomains: parseResult.uniqueDomains,
        lastUpdated: now,
      };
    }

    await put('metadata.json', JSON.stringify(metadata), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

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
