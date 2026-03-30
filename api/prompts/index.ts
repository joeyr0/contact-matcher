import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDefaultPromptConfig, readPromptConfig, resetPromptValue, updatePromptValue } from '../../src/lib/promptConfig.js';
import type { PromptConfig } from '../../src/lib/types.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({
      prompts: readPromptConfig(),
      defaults: getDefaultPromptConfig(),
    });
  }

  if (req.method === 'PUT') {
    const { key, value } = req.body as { key?: keyof PromptConfig; value?: string };
    if ((key !== 'icpScoring' && key !== 'outbound') || typeof value !== 'string') {
      return res.status(400).json({ error: 'key and value are required' });
    }
    return res.status(200).json({ prompts: updatePromptValue(key, value) });
  }

  if (req.method === 'POST') {
    const { key, action } = req.body as { key?: keyof PromptConfig; action?: string };
    if ((key !== 'icpScoring' && key !== 'outbound') || action !== 'reset') {
      return res.status(400).json({ error: 'key and action=reset are required' });
    }
    return res.status(200).json({ prompts: resetPromptValue(key) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
