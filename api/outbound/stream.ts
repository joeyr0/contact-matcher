import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateOutboundDrafts } from '../../src/lib/outboundServer.js';
import type { OutboundCandidate } from '../../src/lib/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { candidates } = req.body as { candidates?: unknown };
  if (!Array.isArray(candidates)) {
    return res.status(400).json({ error: 'candidates is a required array' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const drafts = await generateOutboundDrafts(
      candidates as OutboundCandidate[],
      (processed, total) => send({ type: 'progress', processed, total }),
    );

    send({ type: 'complete', drafts });
    res.end();
  } catch (error) {
    send({ type: 'error', error: error instanceof Error ? error.message : String(error) });
    res.end();
  }
}
