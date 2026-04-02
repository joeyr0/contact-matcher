import type { VercelRequest, VercelResponse } from '@vercel/node';
import { advanceIcpJobState } from '../../src/lib/icpServer.js';
import type { IcpJobResponse, IcpJobState } from '../../src/lib/types.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse<IcpJobResponse | { error: string }>) {
  const id = req.query.id;
  if (typeof id !== 'string' || !id) {
    return res.status(400).json({ error: 'job id is required' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The client holds the full job state and passes it back each call.
  // This avoids needing shared storage (Vercel Blob / shared /tmp) between instances.
  const { jobState } = req.body as { jobState?: IcpJobState };
  if (!jobState || jobState.id !== id) {
    return res.status(400).json({ error: 'jobState is required in request body' });
  }

  const nextJob = await advanceIcpJobState(jobState);
  return res.status(200).json({
    job: {
      id: nextJob.id,
      status: nextJob.status,
      progress: nextJob.progress,
      error: nextJob.error,
      updatedAt: nextJob.updatedAt,
      results: nextJob.status === 'complete' ? nextJob.rows : undefined,
    },
    jobState: nextJob.status !== 'complete' ? nextJob : undefined,
  });
}
