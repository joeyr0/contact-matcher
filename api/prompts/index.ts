import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { PromptConfig } from '../../src/lib/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { getDefaultPromptConfig, readPromptConfigAsync, resetPromptValueAsync, updatePromptValueAsync } = await import(
      '../../src/lib/promptConfig.js'
    );

    if (req.method === 'GET') {
      return res.status(200).json({
        prompts: await readPromptConfigAsync(),
        defaults: getDefaultPromptConfig(),
      });
    }

    if (req.method === 'PUT') {
      const { key, value } = req.body as { key?: keyof PromptConfig; value?: string };
      if ((key !== 'icpScoring' && key !== 'contactScoring' && key !== 'outbound') || typeof value !== 'string') {
        return res.status(400).json({ error: 'key and value are required' });
      }
      return res.status(200).json({ prompts: await updatePromptValueAsync(key, value) });
    }

    if (req.method === 'POST') {
      const { key, action } = req.body as { key?: keyof PromptConfig; action?: string };
      if ((key !== 'icpScoring' && key !== 'contactScoring' && key !== 'outbound') || action !== 'reset') {
        return res.status(400).json({ error: 'key and action=reset are required' });
      }
      return res.status(200).json({ prompts: await resetPromptValueAsync(key) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
