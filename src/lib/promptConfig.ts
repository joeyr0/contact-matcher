import fs from 'fs';
import path from 'path';
import { DEFAULT_CONTACT_PROMPT, DEFAULT_ICP_PROMPT, DEFAULT_OUTBOUND_PROMPT } from './promptDefaults';
import type { PromptConfig } from './types';
import { readDataJSON, writeDataJSON } from '../../api/lib/readData.js';

function getDataDir(): string {
  return path.join(process.cwd(), 'data');
}

function getPromptsPath(): string {
  return path.join(getDataDir(), 'prompts.json');
}

export function getDefaultPromptConfig(): PromptConfig {
  return {
    icpScoring: { value: DEFAULT_ICP_PROMPT, lastUpdated: null },
    contactScoring: { value: DEFAULT_CONTACT_PROMPT, lastUpdated: null },
    outbound: { value: DEFAULT_OUTBOUND_PROMPT, lastUpdated: null },
  };
}

export function readPromptConfig(): PromptConfig {
  const defaults = getDefaultPromptConfig();
  const promptsPath = getPromptsPath();
  try {
    if (!fs.existsSync(promptsPath)) return defaults;
    const parsed = JSON.parse(fs.readFileSync(promptsPath, 'utf-8')) as Partial<PromptConfig>;
    return {
      icpScoring: {
        value: parsed.icpScoring?.value || defaults.icpScoring.value,
        lastUpdated: parsed.icpScoring?.lastUpdated ?? null,
      },
      contactScoring: {
        value: parsed.contactScoring?.value || defaults.contactScoring.value,
        lastUpdated: parsed.contactScoring?.lastUpdated ?? null,
      },
      outbound: {
        value: parsed.outbound?.value || defaults.outbound.value,
        lastUpdated: parsed.outbound?.lastUpdated ?? null,
      },
    };
  } catch {
    return defaults;
  }
}

export async function readPromptConfigAsync(): Promise<PromptConfig> {
  const defaults = getDefaultPromptConfig();
  const parsed = await readDataJSON<Partial<PromptConfig>>('prompts.json');
  if (!parsed) return defaults;
  return {
    icpScoring: {
      value: parsed.icpScoring?.value || defaults.icpScoring.value,
      lastUpdated: parsed.icpScoring?.lastUpdated ?? null,
    },
    contactScoring: {
      value: parsed.contactScoring?.value || defaults.contactScoring.value,
      lastUpdated: parsed.contactScoring?.lastUpdated ?? null,
    },
    outbound: {
      value: parsed.outbound?.value || defaults.outbound.value,
      lastUpdated: parsed.outbound?.lastUpdated ?? null,
    },
  };
}

export function writePromptConfig(config: PromptConfig): PromptConfig {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(getPromptsPath(), JSON.stringify(config), 'utf-8');
  return config;
}

export async function writePromptConfigAsync(config: PromptConfig): Promise<PromptConfig> {
  await writeDataJSON('prompts.json', config);
  return config;
}

export function updatePromptValue(key: keyof PromptConfig, value: string): PromptConfig {
  const current = readPromptConfig();
  current[key] = {
    value,
    lastUpdated: new Date().toISOString(),
  };
  return writePromptConfig(current);
}

export async function updatePromptValueAsync(key: keyof PromptConfig, value: string): Promise<PromptConfig> {
  const current = await readPromptConfigAsync();
  current[key] = {
    value,
    lastUpdated: new Date().toISOString(),
  };
  return writePromptConfigAsync(current);
}

export function resetPromptValue(key: keyof PromptConfig): PromptConfig {
  const current = readPromptConfig();
  const defaults = getDefaultPromptConfig();
  current[key] = {
    value: defaults[key].value,
    lastUpdated: new Date().toISOString(),
  };
  return writePromptConfig(current);
}

export async function resetPromptValueAsync(key: keyof PromptConfig): Promise<PromptConfig> {
  const current = await readPromptConfigAsync();
  const defaults = getDefaultPromptConfig();
  current[key] = {
    value: defaults[key].value,
    lastUpdated: new Date().toISOString(),
  };
  return writePromptConfigAsync(current);
}
