import OpenAI from 'openai';
import type { OutboundCandidate, OutboundDraft } from './types';
import { readPromptConfig } from './promptConfig';
import { DEFAULT_OUTBOUND_PROMPT } from './promptDefaults';

const MODEL = process.env.OPENAI_OUTBOUND_MODEL || process.env.OPENAI_SCORING_MODEL || 'gpt-5-mini';
const OUTBOUND_BATCH_SIZE = 8;

function getOutboundPrompt(): string {
  return readPromptConfig().outbound.value || DEFAULT_OUTBOUND_PROMPT;
}

function batchArray<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

async function callOpenAIJson<T>(client: OpenAI, userPayload: unknown): Promise<T> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: getOutboundPrompt() },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? '';
  if (!content) throw new Error('Empty outbound response from OpenAI');
  return JSON.parse(content) as T;
}

export async function generateOutboundDrafts(
  candidates: OutboundCandidate[],
  onProgress?: (processed: number, total: number) => void,
): Promise<OutboundDraft[]> {
  if (candidates.length === 0) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

  const client = new OpenAI({ apiKey });
  const drafts: OutboundDraft[] = [];
  const batches = batchArray(candidates, OUTBOUND_BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i] ?? [];
    const response = await callOpenAIJson<{ drafts?: Array<Record<string, unknown>> }>(client, { leads: batch });
    for (const raw of response.drafts ?? []) {
      const key = String(raw.key ?? '');
      if (!key) continue;
      drafts.push({
        key,
        subject: String(raw.subject ?? '').slice(0, 160),
        email1: String(raw.email1 ?? '').slice(0, 1500),
        email2: String(raw.email2 ?? '').slice(0, 1200),
        linkedinMessage: String(raw.linkedinMessage ?? '').slice(0, 800),
        rationale: String(raw.rationale ?? '').slice(0, 160),
      });
    }
    onProgress?.(Math.min((i + 1) * OUTBOUND_BATCH_SIZE, candidates.length), candidates.length);
  }

  return drafts;
}
