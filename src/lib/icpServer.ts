import type { CompactScoreRow, EnrichedRow, IcpJobState, MatchResult } from './types';
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
} from './icp.js';
import { readPromptConfig } from './promptConfig.js';
import { DEFAULT_CONTACT_PROMPT, DEFAULT_ICP_PROMPT } from './promptDefaults.js';
import { callStructuredJson } from './aiProvider.js';

const COMPANY_BATCH_SIZE = 20;
const CONTACT_BATCH_SIZE = 25;

function getCompanyPrompt(): string {
  return readPromptConfig().icpScoring.value || DEFAULT_ICP_PROMPT;
}
function getContactPrompt(): string {
  return readPromptConfig().contactScoring.value || DEFAULT_CONTACT_PROMPT;
}

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

async function scoreCompaniesWithLLM(
  companies: CompanyScoreInput[],
  onProgress?: (stage: 'companies' | 'contacts', processed: number, total: number) => void,
): Promise<Map<string, CompanyScoreResult>> {
  const result = new Map<string, CompanyScoreResult>();
  const batches = batchArray(companies, COMPANY_BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i] ?? [];
    const payload = { companies: batch };
    const response = await callStructuredJson<{ companies?: Array<Record<string, unknown>> }>(
      getCompanyPrompt(),
      payload,
      'scoring',
    );
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

async function scoreCompanyBatch(companies: CompanyScoreInput[]): Promise<Map<string, CompanyScoreResult>> {
  const result = new Map<string, CompanyScoreResult>();
  if (companies.length === 0) return result;
  const response = await callStructuredJson<{ companies?: Array<Record<string, unknown>> }>(
    getCompanyPrompt(),
    { companies },
    'scoring',
  );
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
  return result;
}

async function scoreContactsWithLLM(
  contacts: ContactScoreInput[],
  onProgress?: (stage: 'companies' | 'contacts', processed: number, total: number) => void,
): Promise<Map<string, ContactScoreResult>> {
  const result = new Map<string, ContactScoreResult>();
  const batches = batchArray(contacts, CONTACT_BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i] ?? [];
    const payload = { contacts: batch };
    const response = await callStructuredJson<{ contacts?: Array<Record<string, unknown>> }>(
      getContactPrompt(),
      payload,
      'scoring',
    );
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

async function scoreContactBatch(contacts: ContactScoreInput[]): Promise<Map<string, ContactScoreResult>> {
  const result = new Map<string, ContactScoreResult>();
  if (contacts.length === 0) return result;
  const response = await callStructuredJson<{ contacts?: Array<Record<string, unknown>> }>(
    getContactPrompt(),
    { contacts },
    'scoring',
  );
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

function prepareContactInputs(headers: string[], rows: EnrichedRow[]): ContactScoreInput[] {
  const contactInputs: ContactScoreInput[] = [];
  rows.forEach((row, index) => {
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
  return contactInputs;
}

export function createIcpJobState(headers: string[], rows: EnrichedRow[], id: string): IcpJobState {
  const nextRows = rows.map(cloneRow);
  nextRows.forEach((row) => {
    row.match = applyDeterministicAccountRoute(row.match, classifyAccountRoute(row));
  });

  const companies = buildScoreableCompanies(nextRows);
  const companyInputs = companies.map((company) => ({
    key: company.key,
    company: company.company,
    domain: company.domain,
    rowIndexes: company.rowIndexes,
  }));
  const now = new Date().toISOString();
  return {
    id,
    status: companyInputs.length > 0 ? 'running' : 'complete',
    createdAt: now,
    updatedAt: now,
    error: null,
    headers,
    rows: nextRows,
    companyInputs,
    companyCursor: 0,
    contactInputs: [],
    contactCursor: 0,
    progress: companyInputs.length > 0 ? { stage: 'companies', processed: 0, total: companyInputs.length } : { stage: 'complete', processed: 0, total: 0 },
  };
}

export async function advanceIcpJobState(job: IcpJobState): Promise<IcpJobState> {
  if (job.status === 'complete' || job.status === 'error') return job;

  try {
    if (job.companyCursor < job.companyInputs.length) {
      const batch = job.companyInputs.slice(job.companyCursor, job.companyCursor + COMPANY_BATCH_SIZE);
      const batchScores = await scoreCompanyBatch(
        batch.map(({ key, company, domain }) => ({ key, company, domain })),
      );
      for (const company of batch) {
        const score = batchScores.get(company.key);
        if (!score) continue;
        for (const rowIndex of company.rowIndexes) {
          const row = job.rows[rowIndex];
          if (!row) continue;
          row.match = applyCompanyScore(row.match, score);
        }
      }
      job.companyCursor += batch.length;
      job.progress = {
        stage: 'companies',
        processed: job.companyCursor,
        total: job.companyInputs.length,
      };
      if (job.companyCursor < job.companyInputs.length) {
        job.updatedAt = new Date().toISOString();
        return job;
      }
      job.contactInputs = prepareContactInputs(job.headers, job.rows);
      job.contactCursor = 0;
      job.progress = {
        stage: 'contacts',
        processed: 0,
        total: job.contactInputs.length,
      };
      if (job.contactInputs.length === 0) {
        job.rows.forEach((row) => {
          row.match.leadPriority = computeLeadPriority(row.match);
        });
        job.status = 'complete';
        job.progress = { stage: 'complete', processed: 0, total: 0 };
        job.updatedAt = new Date().toISOString();
        return job;
      }
    }

    if (job.contactCursor < job.contactInputs.length) {
      const batch = job.contactInputs.slice(job.contactCursor, job.contactCursor + CONTACT_BATCH_SIZE);
      const batchScores = await scoreContactBatch(batch);
      for (const input of batch) {
        const score = batchScores.get(input.key);
        if (!score) continue;
        const row = job.rows[Number(input.key)];
        if (!row) continue;
        row.match.contactScore = score.contactScore;
        row.match.contactPriority = mapContactPriority(score.contactScore);
        row.match.roleFit = score.roleFit;
        row.match.contactReasonSummary = score.reasonSummary;

        const contact = extractContactFields(job.headers, row.originalRow);
        if (isSeniorRelevantTitle(contact.title) && row.match.contactPriority === 'low') {
          row.match.contactScore = 4;
          row.match.contactPriority = 'medium';
          row.match.roleFit = row.match.roleFit || 'senior_relevant_function';
          row.match.contactReasonSummary =
            row.match.contactReasonSummary || 'Senior leader in a relevant function for crypto or wallet initiatives.';
        }
      }
      job.contactCursor += batch.length;
      job.progress = {
        stage: 'contacts',
        processed: job.contactCursor,
        total: job.contactInputs.length,
      };
      if (job.contactCursor >= job.contactInputs.length) {
        job.rows.forEach((row) => {
          row.match.leadPriority = computeLeadPriority(row.match);
        });
        job.status = 'complete';
        job.progress = { stage: 'complete', processed: job.contactInputs.length, total: job.contactInputs.length };
      }
    }

    job.updatedAt = new Date().toISOString();
    return job;
  } catch (error) {
    job.status = 'error';
    job.error = error instanceof Error ? error.message : String(error);
    job.updatedAt = new Date().toISOString();
    return job;
  }
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

  const companyInputs: CompanyScoreInput[] = companies.map((company) => ({
    key: company.key,
    company: company.company,
    domain: company.domain,
  }));

  const companyScores = await scoreCompaniesWithLLM(companyInputs, onProgress);

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
    const contactScores = await scoreContactsWithLLM(contactInputs, onProgress);
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
