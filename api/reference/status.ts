import type { VercelRequest, VercelResponse } from '@vercel/node';
import { list } from '@vercel/blob';
import type { ReferenceStatus } from '../../src/lib/types';

const defaultStatus: ReferenceStatus = {
  sheet15: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
  optout: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { blobs } = await list({ prefix: 'metadata.json', token: process.env.BLOB_READ_WRITE_TOKEN });
    const metaBlob = blobs.find((b) => b.pathname === 'metadata.json');
    if (!metaBlob) return res.status(200).json(defaultStatus);

    const metaRes = await fetch(metaBlob.url);
    if (!metaRes.ok) return res.status(200).json(defaultStatus);

    const metadata = (await metaRes.json()) as ReferenceStatus;
    return res.status(200).json(metadata);
  } catch {
    return res.status(200).json(defaultStatus);
  }
}
