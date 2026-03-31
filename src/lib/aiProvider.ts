import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getActiveProvider, getResolvedApiKey, type ApiProvider } from './apiKeyConfig';

const OPENAI_MODEL = process.env.OPENAI_SCORING_MODEL || 'gpt-5-mini';
const OPENAI_OUTBOUND_MODEL = process.env.OPENAI_OUTBOUND_MODEL || process.env.OPENAI_SCORING_MODEL || 'gpt-5-mini';
const OPENAI_FUZZY_MODEL = process.env.OPENAI_FUZZY_MODEL || 'gpt-4o-mini';

const ANTHROPIC_MODEL = process.env.ANTHROPIC_SCORING_MODEL || 'claude-sonnet-4-20250514';
const ANTHROPIC_OUTBOUND_MODEL =
  process.env.ANTHROPIC_OUTBOUND_MODEL || process.env.ANTHROPIC_SCORING_MODEL || 'claude-sonnet-4-20250514';
const ANTHROPIC_FUZZY_MODEL = process.env.ANTHROPIC_FUZZY_MODEL || 'claude-sonnet-4-20250514';

function extractAnthropicText(content: Anthropic.Messages.Message['content']): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function normalizeJsonText(content: string): string {
  return content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

export function getConfiguredProvider(): ApiProvider {
  return getActiveProvider();
}

export function getConfiguredKey(provider = getConfiguredProvider()): string {
  return getResolvedApiKey(provider);
}

export async function callStructuredJson<T>(systemPrompt: string, userPayload: unknown, mode: 'scoring' | 'outbound'): Promise<T> {
  const provider = getConfiguredProvider();
  const apiKey = getConfiguredKey(provider);
  if (!apiKey) {
    throw new Error(`${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} not configured`);
  }

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey });
    const model = mode === 'outbound' ? OPENAI_OUTBOUND_MODEL : OPENAI_MODEL;
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? '';
    if (!content) throw new Error('Empty JSON response from OpenAI');
    return JSON.parse(content) as T;
  }

  const client = new Anthropic({ apiKey });
  const model = mode === 'outbound' ? ANTHROPIC_OUTBOUND_MODEL : ANTHROPIC_MODEL;
  const completion = await client.messages.create({
    model,
    max_tokens: 4096,
    system: `${systemPrompt}\n\nReturn valid JSON only. Do not wrap in markdown fences.`,
    messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
  });
  const content = normalizeJsonText(extractAnthropicText(completion.content));
  if (!content) throw new Error('Empty JSON response from Anthropic');
  return JSON.parse(content) as T;
}

export async function callTextCompletion(systemPrompt: string, userText: string): Promise<string> {
  const provider = getConfiguredProvider();
  const apiKey = getConfiguredKey(provider);
  if (!apiKey) {
    throw new Error(`${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} not configured`);
  }

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: OPENAI_FUZZY_MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    });
    return completion.choices[0]?.message?.content ?? '';
  }

  const client = new Anthropic({ apiKey });
  const completion = await client.messages.create({
    model: ANTHROPIC_FUZZY_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userText }],
  });
  return extractAnthropicText(completion.content);
}
