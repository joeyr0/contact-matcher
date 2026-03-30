import OpenAI from 'openai';
import type { EnrichedRow, MatchResult } from './types';
import {
  applyDeterministicAccountRoute,
  buildScoreableCompanies,
  classifyAccountRoute,
  computeLeadPriority,
  extractContactFields,
  getCompanyKey,
  getPreferredCompanyDomain,
  getPreferredCompanyName,
  isObviousContactExclude,
  mapAccountPriority,
  mapContactPriority,
  mapTvcRelevance,
  type CompanyScoreInput,
  type CompanyScoreResult,
  type ContactScoreInput,
  type ContactScoreResult,
} from './icp';

const MODEL = process.env.OPENAI_SCORING_MODEL || 'gpt-4.1-2025-04-14';

const COMPANY_BATCH_SIZE = 20;
const CONTACT_BATCH_SIZE = 25;

const COMPANY_PROMPT = `You are a senior GTM strategy analyst for Turnkey.

Your task is only to classify company ICP fit for outbound, not to write messaging.

ABOUT TURNKEY
Turnkey provides wallet and signing infrastructure for crypto and crypto-adjacent companies. Core use cases:
- embedded consumer wallets
- embedded business wallets
- wallet-as-a-service
- agentic wallets
- transaction signing
- smart contract management
- key management
- payment orchestration
- treasury / issuance
- verifiable compute for custodians, exchanges, MPC and wallet infrastructure

OUTPUT GOAL
For each company, decide:
- icpScore from 1 to 5
- confidence: high, medium, or low
- primaryUseCase
- tvcScore from 1 to 5
- whether the company is a referral source
- whether the company is a direct competitor
- a concise reasonSummary under 18 words

SCORING
5 = obvious direct Turnkey target now
4 = strong fit, likely relevant in 12 months
3 = plausible and credible fit, but not top priority
2 = weak fit
1 = not a target

IMPORTANT RULES
- Crypto exchanges, DeFi, wallets, RWA, stablecoin, and crypto payments companies often score 4-5.
- Fintechs or payments companies with credible crypto expansion can score 4-5.
- Traditional banks without strong digital-asset evidence should usually stay 2-3.
- AI companies with no crypto relevance should score 1.
- Agencies, consultants, dev shops, and investors are referral sources, not direct outbound targets.
- Known wallet/key-management competitors should set isCompetitor=true and icpScore=1.
- If public signal is weak, reduce confidence instead of inflating score.

OUTPUT
Return valid JSON only:
{
  "companies": [
    {
      "key": "unique-key",
      "icpScore": 4,
      "confidence": "high",
      "primaryUseCase": "transaction_signing",
      "tvcScore": 2,
      "isReferralSource": false,
      "isCompetitor": false,
      "reasonSummary": "High-volume crypto operations likely need programmable signing infrastructure."
    }
  ]
}`;

const CONTACT_PROMPT = `You are a senior BDR manager for Turnkey.

Your task is only to classify whether a contact is worth outbound at a company that has already been company-scored.

For each contact, score the person's role fit for outbound:
- 5 = direct decision maker
- 4 = strong influencer / likely champion
- 3 = relevant but not primary buyer
- 2 = weak contact
- 1 = do not prioritize

IMPORTANT RULES
- CTO, CEO, founder, VP/Head of Engineering, Head of Crypto, Head of Digital Assets often score 4-5.
- Senior engineering, product, platform, payments, treasury, infrastructure leaders often score 3-4.
- Marketing, general BD, general ops, finance, legal usually score 1-2 unless title strongly indicates crypto ownership.
- HR, recruiting, PR, office admin, interns, students should score 1.
- Keep roleFit short, for example: decision_maker, engineering_leader, crypto_owner, product_influence, low_relevance, excluded_role.

Return valid JSON only:
{
  "contacts": [
    {
      "key": "row-key",
      "contactScore": 4,
      "roleFit": "engineering_leader",
      "reasonSummary": "Engineering leader at a high-fit account."
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

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  if (typeof value !== 'string') return 'low';
  const normalized = value.toLowerCase();
  return normalized === 'high' || normalized === 'medium' || normalized === 'low' ? normalized : 'low';
}

function normalizeScore(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const num = typeof value === 'number' ? value : Number(value);
  if (num >= 5) return 5;
  if (num <= 1) return 1;
  if (num === 2 || num === 3 || num === 4) return num;
  return 2;
}

async function callOpenAIJson<T>(client: OpenAI, systemPrompt: string, userPayload: unknown): Promise<T> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(userPayload) },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? '';
  if (!content) throw new Error('Empty scoring response from OpenAI');
  return JSON.parse(content) as T;
}

async function scoreCompaniesWithLLM(
  client: OpenAI,
  companies: CompanyScoreInput[],
  onProgress?: (stage: 'companies' | 'contacts', processed: number, total: number) => void,
): Promise<Map<string, CompanyScoreResult>> {
  const result = new Map<string, CompanyScoreResult>();
  const batches = batchArray(companies, COMPANY_BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i] ?? [];
    const payload = { companies: batch };
    const response = await callOpenAIJson<{ companies?: Array<Record<string, unknown>> }>(client, COMPANY_PROMPT, payload);
    for (const raw of response.companies ?? []) {
      const key = String(raw.key ?? '');
      if (!key) continue;
      result.set(key, {
        key,
        icpScore: normalizeScore(raw.icpScore),
        confidence: normalizeConfidence(raw.confidence),
        primaryUseCase: String(raw.primaryUseCase ?? ''),
        tvcScore: normalizeScore(raw.tvcScore),
        isReferralSource: Boolean(raw.isReferralSource),
        isCompetitor: Boolean(raw.isCompetitor),
        reasonSummary: String(raw.reasonSummary ?? '').slice(0, 160),
      });
    }
    onProgress?.('companies', Math.min((i + 1) * COMPANY_BATCH_SIZE, companies.length), companies.length);
  }

  return result;
}

async function scoreContactsWithLLM(
  client: OpenAI,
  contacts: ContactScoreInput[],
  onProgress?: (stage: 'companies' | 'contacts', processed: number, total: number) => void,
): Promise<Map<string, ContactScoreResult>> {
  const result = new Map<string, ContactScoreResult>();
  const batches = batchArray(contacts, CONTACT_BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i] ?? [];
    const payload = { contacts: batch };
    const response = await callOpenAIJson<{ contacts?: Array<Record<string, unknown>> }>(client, CONTACT_PROMPT, payload);
    for (const raw of response.contacts ?? []) {
      const key = String(raw.key ?? '');
      if (!key) continue;
      result.set(key, {
        key,
        contactScore: normalizeScore(raw.contactScore),
        roleFit: String(raw.roleFit ?? '').slice(0, 80),
        reasonSummary: String(raw.reasonSummary ?? '').slice(0, 160),
      });
    }
    onProgress?.('contacts', Math.min((i + 1) * CONTACT_BATCH_SIZE, contacts.length), contacts.length);
  }

  return result;
}

function cloneRow(row: EnrichedRow): EnrichedRow {
  return {
    ...row,
    originalRow: [...row.originalRow],
    match: { ...row.match },
  };
}

function applyCompanyScore(match: MatchResult, score: CompanyScoreResult): MatchResult {
  const next = { ...match };
  if (score.isCompetitor) {
    next.accountStatus = 'competitor';
    next.accountPriority = 'excluded';
    next.isCompetitor = 'TRUE';
    next.icpScore = 1;
    next.icpConfidence = score.confidence;
    next.primaryUseCase = score.primaryUseCase;
    next.tvcScore = score.tvcScore;
    next.tvcRelevance = mapTvcRelevance(score.tvcScore);
    next.icpReasonSummary = score.reasonSummary || 'Known competitor';
    return next;
  }
  if (score.isReferralSource) {
    next.accountStatus = 'referral_source';
    next.accountPriority = 'excluded';
  } else {
    next.accountStatus = 'eligible';
    next.accountPriority = mapAccountPriority(score.icpScore);
  }
  next.icpScore = score.icpScore;
  next.icpConfidence = score.confidence;
  next.primaryUseCase = score.primaryUseCase;
  next.tvcScore = score.tvcScore;
  next.tvcRelevance = mapTvcRelevance(score.tvcScore);
  next.icpReasonSummary = score.reasonSummary;
  next.isCompetitor = score.isCompetitor ? 'TRUE' : 'FALSE';
  return next;
}

export async function scoreEnrichedRows(
  headers: string[],
  rows: EnrichedRow[],
  onProgress?: (stage: 'companies' | 'contacts', processed: number, total: number) => void,
): Promise<EnrichedRow[]> {
  const nextRows = rows.map(cloneRow);

  nextRows.forEach((row) => {
    const routed = applyDeterministicAccountRoute(row.match, classifyAccountRoute(row));
    row.match = routed;
  });

  const companies = buildScoreableCompanies(nextRows);
  if (companies.length === 0) {
    nextRows.forEach((row) => {
      row.match.leadPriority = computeLeadPriority(row.match);
    });
    return nextRows;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const client = new OpenAI({ apiKey });

  const companyInputs: CompanyScoreInput[] = companies.map((company) => ({
    key: company.key,
    company: company.company,
    domain: company.domain,
  }));

  const companyScores = await scoreCompaniesWithLLM(client, companyInputs, onProgress);

  for (const company of companies) {
    const score = companyScores.get(company.key);
    if (!score) continue;
    for (const rowIndex of company.rowIndexes) {
      const row = nextRows[rowIndex];
      if (!row) continue;
      row.match = applyCompanyScore(row.match, score);
    }
  }

  const contactInputs: ContactScoreInput[] = [];
  nextRows.forEach((row, index) => {
    if (row.match.accountStatus !== 'eligible') return;
    if (row.match.accountPriority !== 'p0' && row.match.accountPriority !== 'p1' && row.match.accountPriority !== 'p2') {
      return;
    }

    const contact = extractContactFields(headers, row.originalRow);
    if (!contact.hasStructuredContact) return;

    if (isObviousContactExclude(contact.title)) {
      row.match.contactScore = 1;
      row.match.contactPriority = 'exclude';
      row.match.roleFit = 'excluded_role';
      row.match.contactReasonSummary = 'Non-buyer role for outbound.';
      return;
    }

    if (!contact.title) return;

    contactInputs.push({
      key: String(index),
      companyKey: getCompanyKey(row),
      name: contact.name,
      title: contact.title,
      email: contact.email,
      company: getPreferredCompanyName(row),
      domain: getPreferredCompanyDomain(row),
      accountPriority: row.match.accountPriority,
      icpScore: row.match.icpScore as 3 | 4 | 5,
      primaryUseCase: row.match.primaryUseCase,
    });
  });

  if (contactInputs.length > 0) {
    const contactScores = await scoreContactsWithLLM(client, contactInputs, onProgress);
    for (const input of contactInputs) {
      const score = contactScores.get(input.key);
      if (!score) continue;
      const row = nextRows[Number(input.key)];
      if (!row) continue;
      row.match.contactScore = score.contactScore;
      row.match.contactPriority = mapContactPriority(score.contactScore);
      row.match.roleFit = score.roleFit;
      row.match.contactReasonSummary = score.reasonSummary;
    }
  } else {
    onProgress?.('contacts', 0, 0);
  }

  nextRows.forEach((row) => {
    row.match.leadPriority = computeLeadPriority(row.match);
  });

  return nextRows;
}
