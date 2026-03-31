import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readDataJSON, writeDataJSON } from '../lib/readData.js';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const tokenPresent = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const payload = {
    ok: true,
    tokenPresent,
    blobAccessMode: 'public',
    runtime: process.env.VERCEL ? 'vercel' : 'local',
    writableFallback: process.env.VERCEL ? '/tmp/contact-matcher-data' : 'project-data-dir',
    timestamp: new Date().toISOString(),
  };

  try {
    await writeDataJSON('debug-storage.json', payload);
    const readBack = await readDataJSON<typeof payload>('debug-storage.json');
    return res.status(200).json({
      ...payload,
      writeReadOk: Boolean(readBack?.timestamp),
      readBack,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      tokenPresent,
      runtime: process.env.VERCEL ? 'vercel' : 'local',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
