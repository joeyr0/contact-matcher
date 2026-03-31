import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getApiKeyStatusesAsync,
  resetApiKeyValueAsync,
  updateApiProviderAsync,
  updateApiKeyValueAsync,
} from '../../../src/lib/apiKeyConfig.js';
type Provider = 'openai' | 'anthropic';

function isProvider(value: unknown): value is Provider {
  return value === 'openai' || value === 'anthropic';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ keys: await getApiKeyStatusesAsync() });
    }

    if (req.method === 'PUT') {
      const { provider, value, mode } = req.body as { provider?: unknown; value?: unknown; mode?: unknown };
      if (!isProvider(provider) || (mode !== 'default' && mode !== 'override')) {
        return res.status(400).json({ error: 'provider and mode are required' });
      }
      await updateApiProviderAsync(provider);
      if (mode === 'override') {
        if (typeof value !== 'string' || !value.trim()) {
          return res.status(400).json({ error: 'non-empty value is required for override mode' });
        }
        await updateApiKeyValueAsync(provider, value.trim());
      } else {
        await resetApiKeyValueAsync(provider);
      }
      return res.status(200).json({ keys: await getApiKeyStatusesAsync() });
    }

    if (req.method === 'POST') {
      const { provider, action } = req.body as { provider?: unknown; action?: unknown };
      if (!isProvider(provider) || action !== 'reset') {
        return res.status(400).json({ error: 'provider and action=reset are required' });
      }
      await resetApiKeyValueAsync(provider);
      return res.status(200).json({ keys: await getApiKeyStatusesAsync() });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
