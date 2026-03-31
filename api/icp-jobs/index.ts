import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createIcpJobState, hydrateScoreRows } from '../../src/lib/icpServer.js';
import type { CompactScoreRow, IcpJobResponse } from '../../src/lib/types.js';
import { readDataJSON, writeDataJSON } from '../lib/readData.js';

function jobFile(id: string): string {
  return `icp-job-${id}.json`;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse<IcpJobResponse | { error: string }>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { headers, results } = req.body as { headers?: unknown; results?: unknown };
  if (!Array.isArray(headers) || !Array.isArray(results)) {
    return res.status(400).json({ error: 'headers and results are required arrays' });
  }

  const id = crypto.randomUUID();
  const job = createIcpJobState(headers as string[], hydrateScoreRows(results as CompactScoreRow[]), id);
  await writeDataJSON(jobFile(id), job);

  return res.status(200).json({
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      error: job.error,
      updatedAt: job.updatedAt,
      results: job.status === 'complete' ? job.rows : undefined,
    },
  });
}
