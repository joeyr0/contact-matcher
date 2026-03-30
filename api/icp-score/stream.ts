import type { VercelRequest, VercelResponse } from '@vercel/node';
import { hydrateScoreRows, scoreEnrichedRows } from '../../src/lib/icpServer.js';
import type { CompactScoreRow } from '../../src/lib/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { headers, results } = req.body as { headers?: unknown; results?: unknown };
  if (!Array.isArray(headers) || !Array.isArray(results)) {
    return res.status(400).json({ error: 'headers and results are required arrays' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const scored = await scoreEnrichedRows(
      headers as string[],
      hydrateScoreRows(results as CompactScoreRow[]),
      (stage, processed, total) => send({ type: 'progress', stage, processed, total }),
    );

    send({ type: 'complete', results: scored });
    res.end();
  } catch (error) {
    send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    res.end();
  }
}
