import OpenAI from 'openai';
import type { OutboundCandidate, OutboundDraft } from './types';

const MODEL = process.env.OPENAI_OUTBOUND_MODEL || process.env.OPENAI_SCORING_MODEL || 'gpt-5-mini';
const OUTBOUND_BATCH_SIZE = 8;

const OUTBOUND_PROMPT = `You are an expert outbound writer for Turnkey.

Your job is to draft concise, specific outbound copy for already-qualified leads.

TURNKEY FACTS
- Turnkey is wallet and signing infrastructure: generate wallets, sign transactions, manage policies.
- Turnkey is strongest where companies need embedded wallets, company wallets, issuance, payment orchestration, smart contract management, key management, disaster recovery, or agentic wallets.
- Strong proof points include Bridge (acquired by Stripe), Polymarket, World, Flutterwave, Alchemy, Superstate, Maple, Moonshot, Axiom, Anchorage, Aave, Magic Eden.
- Turnkey is not a custodian, not a bank, and does not compete with its customers.

WRITING RULES
- No em dashes.
- No hype, no vague platitudes, no generic “thought this might be relevant.”
- Sound like a sharp revenue leader writing to a serious operator.
- Keep the copy grounded in the lead's company, title, and likely Turnkey use case.
- Mention at most 2 relevant proof points.
- If the contact is a connector role (for example partnerships or BD), write toward opening the right internal conversation, not pretending they own infra.
- If the contact is a direct technical or crypto owner, write toward wallet/signing infrastructure ownership.

OUTPUT
Return valid JSON only:
{
  "drafts": [
    {
      "key": "row-key",
      "subject": "short subject",
      "email1": "90-130 words",
      "email2": "45-80 words",
      "linkedinMessage": "40-70 words",
      "rationale": "short internal rationale under 18 words"
    }
  ]
}`;

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
      { role: 'system', content: OUTBOUND_PROMPT },
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
