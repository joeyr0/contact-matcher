import OpenAI from 'openai';
import type { CompactScoreRow, EnrichedRow, MatchResult } from './types';
import {
  applyDeterministicAccountRoute,
  buildScoreableCompanies,
  classifyAccountRoute,
  computeLeadPriority,
  extractContactFields,
  getCompanyKey,
  getPreferredCompanyDomain,
  getPreferredCompanyName,
  isLowPriorityCommercialRole,
  isObviousContactExclude,
  isSeniorConnectorTitle,
  isSeniorRelevantTitle,
  mapAccountPriority,
  mapContactPriority,
  mapTvcRelevance,
  type CompanyScoreInput,
  type CompanyScoreResult,
  type ContactScoreInput,
  type ContactScoreResult,
} from './icp';

const MODEL = process.env.OPENAI_SCORING_MODEL || 'gpt-5-mini';

const COMPANY_BATCH_SIZE = 20;
const CONTACT_BATCH_SIZE = 25;

const COMPANY_PROMPT = `You are a senior GTM strategy analyst for Turnkey.

Your task is only to classify company ICP fit for outbound, not to write messaging.

ABOUT TURNKEY
Turnkey is wallet and signing infrastructure: the programmable secure layer between applications and cryptographic key operations.

Three core capabilities:
- generate wallets
- sign transactions
- manage policies and approvals around key access

Turnkey is most relevant when a company has, or is likely to have within 12 months, a real need for wallet infrastructure, secure signing, programmable approval policies, embedded wallets, company wallets, issuance workflows, transaction automation, treasury operations, smart contract operations, key escrow, or disaster recovery.

PRIMARY USE CASES
- embedded_consumer_wallets
- embedded_business_wallets
- wallet_as_a_service
- agentic_wallets
- payment_orchestration
- issuance
- smart_contract_management
- key_management
- disaster_recovery
- verifiable_compute

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
Score based on whether the company could plausibly leverage Turnkey's wallet, signing, or programmable policy technology.

5 = obvious direct Turnkey target now because there is a concrete wallet/signing/policy use case
4 = strong fit and likely to need Turnkey-like infrastructure in 12 months
3 = plausible fit, but the use case is weaker or less immediate
2 = weak fit; no clear near-term wallet/signing need
1 = not a target

IMPORTANT RULES
- First identify the concrete Turnkey use case. If you cannot name one credibly, do not score above 3.
- Crypto exchanges, DeFi apps, stablecoin/payment infrastructure, tokenization/issuance platforms, wallet products, and crypto developer platforms often score 4-5.
- Tokenization and issuance companies such as Securitize should be treated as strong direct fits because issuance and policy-governed onchain operations map directly to Turnkey.
- Cross-border payments and remittance companies such as MoneyGram can be strong fits when stablecoin, wallets, or transaction automation are credible.
- Traditional banks without clear digital-asset product ownership should usually stay 2-3.
- AI companies with no crypto or wallet relevance should score 1.
- Foundations, associations, ecosystem groups, and governance bodies without clear product or transaction ownership should usually score 2-3, not 4-5.
- Agencies, consultants, dev shops, and investors are referral sources, not direct outbound targets.
- Only mark isCompetitor=true for direct developer-facing wallet, embedded wallet, or key-management infrastructure competitors.
- Do NOT mark broad parent companies or adjacent infrastructure as competitors unless they clearly sell the directly substitutable wallet/signing developer product.
- Examples that are often adjacent or still prospect-worthy rather than automatic competitors: Coinbase, BitGo.
- Examples of direct competitors: Fireblocks, Privy, Dynamic, Dfns, Magic, Utila, Portal, Evervault, Coinbase CDP.
- If public signal is weak, reduce confidence instead of inflating score.

CALIBRATION EXAMPLES
- Alchemy: strong fit because wallet-as-a-service and embedded accounts map directly
- Flutterwave: strong fit because embedded business wallets and cross-border payments map directly
- Polymarket: strong fit because smart contract operations and automated signing map directly
- Superstate and Maple: strong fit because issuance and policy-governed onchain capital map directly
- World: strong fit because key escrow and recovery map directly
- Securitize: strong fit because issuance/tokenization/policy controls map directly
- MoneyGram: credible to strong fit because remittance plus stablecoin/payment orchestration is a clear wallet/signing adjacency

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
- Senior security, cyber, risk, fraud, trust, compliance, and operations leaders at relevant accounts should usually score at least 4, not 3.
- Senior partnerships and business development leaders can be useful connectors at large strategic accounts and should usually score 3-4, not 1-2.
- Marketing usually scores 1-2.
- General junior BD, general ops, finance, legal usually score 1-2 unless title strongly indicates crypto ownership.
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

function emptyMatch(): MatchResult {
  return {
    sfAccountName: '',
    sfAccountId: '',
    sfAccountOwner: '',
    stripeCustomerId: '',
    tkCustomerId: '',
    sfOptOut: '',
    sfOptOutSpecificContacts: '',
    sfOptOutNotes: '',
    isActiveCustomer: '',
    customerMatchMethod: '',
    customerMatchConfidence: '',
    isCustomer: 'no',
    possibleCustomer: '',
    possibleCustomerConfidence: '',
    possibleCustomerReason: '',
    customerTier: '',
    stripeSubscriptionStatus: '',
    arrCustomerName: '',
    accountStatus: '',
    accountPriority: '',
    icpScore: '',
    icpConfidence: '',
    primaryUseCase: '',
    tvcScore: '',
    tvcRelevance: '',
    icpReasonSummary: '',
    isCompetitor: '',
    contactScore: '',
    contactPriority: '',
    roleFit: '',
    contactReasonSummary: '',
    leadPriority: '',
    matchMethod: 'no_match',
    matchConfidence: '',
    sfMatchedDomain: '',
  };
}

export function hydrateScoreRows(rows: CompactScoreRow[]): EnrichedRow[] {
  return rows.map((row) => ({
    originalRow: Array.isArray(row.originalRow) ? row.originalRow : [],
    domain: typeof row.domain === 'string' ? row.domain : '',
    companyName: typeof row.companyName === 'string' ? row.companyName : '',
    match: {
      ...emptyMatch(),
      ...(row.match ?? {}),
    },
  }));
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

    if (isLowPriorityCommercialRole(contact.title)) {
      if (isSeniorConnectorTitle(contact.title)) {
        row.match.contactScore = 4;
        row.match.contactPriority = 'medium';
        row.match.roleFit = 'senior_connector';
        row.match.contactReasonSummary = 'Senior partnerships or business development leader at a relevant account.';
        return;
      }

      row.match.contactScore = 3;
      row.match.contactPriority = 'low';
      row.match.roleFit = 'commercial_low_priority';
      row.match.contactReasonSummary = 'Commercial contact, but not a primary technical buyer.';
      return;
    }

    if (isSeniorRelevantTitle(contact.title)) {
      row.match.contactScore = 4;
      row.match.contactPriority = 'medium';
      row.match.roleFit = 'senior_relevant_function';
      row.match.contactReasonSummary = 'Senior leader in a relevant function for crypto or wallet initiatives.';
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

      const contact = extractContactFields(headers, row.originalRow);
      if (isSeniorRelevantTitle(contact.title) && row.match.contactPriority === 'low') {
        row.match.contactScore = 4;
        row.match.contactPriority = 'medium';
        row.match.roleFit = row.match.roleFit || 'senior_relevant_function';
        row.match.contactReasonSummary =
          row.match.contactReasonSummary || 'Senior leader in a relevant function for crypto or wallet initiatives.';
      }
    }
  } else {
    onProgress?.('contacts', 0, 0);
  }

  nextRows.forEach((row) => {
    row.match.leadPriority = computeLeadPriority(row.match);
  });

  return nextRows;
}
