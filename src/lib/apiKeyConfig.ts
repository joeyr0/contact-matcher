import fs from 'fs';
import path from 'path';
import type { ApiKeyConfig, ApiKeyStatusEntry } from './types';

export type ApiProvider = 'openai' | 'anthropic';

function getDataDir(): string {
  return path.join(process.cwd(), 'data');
}

function getApiKeysPath(): string {
  return path.join(getDataDir(), 'api-keys.json');
}

function getEnvKey(provider: ApiProvider): string {
  if (provider === 'openai') return process.env.OPENAI_API_KEY ?? '';
  return process.env.ANTHROPIC_API_KEY ?? '';
}

function maskKey(value: string): string {
  if (!value) return 'Not configured';
  if (value.length <= 12) return `${value.slice(0, 4)}…${value.slice(-4)}`;
  return `${value.slice(0, 7)}…${value.slice(-4)}`;
}

export function getDefaultApiKeyConfig(): ApiKeyConfig {
  return {
    openai: { value: '', lastUpdated: null },
    anthropic: { value: '', lastUpdated: null },
    provider: 'openai',
  };
}

export function readApiKeyConfig(): ApiKeyConfig {
  const defaults = getDefaultApiKeyConfig();
  const apiKeysPath = getApiKeysPath();
  try {
    if (!fs.existsSync(apiKeysPath)) return defaults;
    const parsed = JSON.parse(fs.readFileSync(apiKeysPath, 'utf-8')) as Partial<ApiKeyConfig>;
    return {
      openai: {
        value: parsed.openai?.value || '',
        lastUpdated: parsed.openai?.lastUpdated ?? null,
      },
      anthropic: {
        value: parsed.anthropic?.value || '',
        lastUpdated: parsed.anthropic?.lastUpdated ?? null,
      },
      provider: parsed.provider === 'anthropic' ? 'anthropic' : 'openai',
    };
  } catch {
    return defaults;
  }
}

function writeApiKeyConfig(config: ApiKeyConfig): ApiKeyConfig {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(getApiKeysPath(), JSON.stringify(config), 'utf-8');
  return config;
}

export function updateApiKeyValue(provider: ApiProvider, value: string): ApiKeyConfig {
  const current = readApiKeyConfig();
  current[provider] = {
    value,
    lastUpdated: new Date().toISOString(),
  };
  return writeApiKeyConfig(current);
}

export function resetApiKeyValue(provider: ApiProvider): ApiKeyConfig {
  const current = readApiKeyConfig();
  current[provider] = {
    value: '',
    lastUpdated: new Date().toISOString(),
  };
  return writeApiKeyConfig(current);
}

export function updateApiProvider(provider: ApiProvider): ApiKeyConfig {
  const current = readApiKeyConfig();
  current.provider = provider;
  return writeApiKeyConfig(current);
}

export function getActiveProvider(): ApiProvider {
  return readApiKeyConfig().provider === 'anthropic' ? 'anthropic' : 'openai';
}

export function getResolvedApiKey(provider: ApiProvider): string {
  const saved = readApiKeyConfig()[provider].value.trim();
  if (saved) return saved;
  return getEnvKey(provider).trim();
}

export function getApiKeyStatuses(): ApiKeyStatusEntry[] {
  const config = readApiKeyConfig();
  return ([
    ['openai', 'OpenAI'],
    ['anthropic', 'Claude / Anthropic'],
  ] as const).map(([provider, label]) => {
    const savedValue = config[provider].value.trim();
    const envValue = getEnvKey(provider).trim();
    const source = savedValue ? 'saved' : envValue ? 'environment' : 'missing';
    const activeValue = savedValue || envValue;
    return {
      provider,
      label,
      active: config.provider === provider,
      source,
      maskedValue: maskKey(activeValue),
      lastUpdated: config[provider].lastUpdated,
    };
  });
}
