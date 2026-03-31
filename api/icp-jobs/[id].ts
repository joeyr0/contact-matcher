import type { VercelRequest, VercelResponse } from '@vercel/node';
import { advanceIcpJobState } from '../../src/lib/icpServer.js';
import type { IcpJobResponse, IcpJobState } from '../../src/lib/types.js';
import { readDataJSON, writeDataJSON } from '../lib/readData.js';

function jobFile(id: string): string {
  return `icp-job-${id}.json`;
}

function toResponse(job: IcpJobState): IcpJobResponse {
  return {
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      error: job.error,
      updatedAt: job.updatedAt,
      results: job.status === 'complete' ? job.rows : undefined,
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse<IcpJobResponse | { error: string }>) {
  const id = req.query.id;
  if (typeof id !== 'string' || !id) {
    return res.status(400).json({ error: 'job id is required' });
  }

  const job = await readDataJSON<IcpJobState>(jobFile(id));
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (req.method === 'GET') {
    return res.status(200).json(toResponse(job));
  }

  if (req.method === 'POST') {
    const nextJob = await advanceIcpJobState(job);
    await writeDataJSON(jobFile(id), nextJob);
    return res.status(200).json(toResponse(nextJob));
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
