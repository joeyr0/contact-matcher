export interface Sheet15Record {
  accountId: string;
  accountName: string;
  accountOwner: string;
  stripeCustomerId?: string; // Stripe "cus_..." id from Salesforce
  tkCustomerId?: string;
}

export interface OptOutRecord {
  accountName: string;
  accountOwner: string;
  optOut: boolean;
  optOutSpecificContacts: boolean;
  notes: string;
}

export type Sheet15Index = Record<string, Sheet15Record>;
export type OptOutIndex = Record<string, OptOutRecord>;

export interface CommittedArrRecord {
  customerId: string; // Stripe "cus_..."
  customerName: string;
  accountOwner: string;
  subscriptionStatus: string; // normalized: active | past_due | canceled | cancelled | ...
  isActiveCustomer: boolean; // active or past_due
  customerTier: 'Enterprise' | 'Pro' | '';
}

export type CommittedArrIndex = Record<string, CommittedArrRecord>;

export interface ReferenceStatus {
  sheet15: {
    loaded: boolean;
    rowCount: number;
    uniqueDomains: number;
    lastUpdated: string | null;
  };
  optout: {
    loaded: boolean;
    rowCount: number;
    uniqueDomains: number;
    lastUpdated: string | null;
  };
  arr: {
    loaded: boolean;
    rowCount: number;
    uniqueCustomers: number;
    lastUpdated: string | null;
  };
}

export interface PromptEntry {
  value: string;
  lastUpdated: string | null;
}

export interface PromptConfig {
  icpScoring: PromptEntry;
  contactScoring: PromptEntry;
  outbound: PromptEntry;
  accountPitch: PromptEntry;
}

export interface ApiKeyEntry {
  value: string;
  lastUpdated: string | null;
}

export interface ApiKeyConfig {
  openai: ApiKeyEntry;
  anthropic: ApiKeyEntry;
  provider: 'openai' | 'anthropic';
}

export interface ApiKeyStatusEntry {
  provider: 'openai' | 'anthropic';
  label: string;
  active: boolean;
  source: 'saved' | 'environment' | 'missing';
  maskedValue: string;
  lastUpdated: string | null;
}

export interface UploadResponse {
  success: boolean;
  rowCount: number;
  uniqueCount: number;
  uniqueLabel: 'domains' | 'customers';
  skippedRows: number;
  error?: string;
}

export interface MatchResult {
  sfAccountName: string;
  sfAccountId: string;
  sfAccountOwner: string;
  stripeCustomerId: string;
  tkCustomerId: string;
  sfOptOut: string; // 'TRUE' | 'FALSE' | ''
  sfOptOutSpecificContacts: string; // 'TRUE' | 'FALSE' | ''
  sfOptOutNotes: string;
  isActiveCustomer: string; // 'TRUE' | 'FALSE' | ''
  customerMatchMethod: '' | 'stripe_id' | 'account_name' | 'domain_root' | 'name_similarity';
  customerMatchConfidence: '' | 'high' | 'medium' | 'low';
  isCustomer: 'yes' | 'maybe' | 'no';
  possibleCustomer: string; // 'TRUE' | 'FALSE' | ''
  possibleCustomerConfidence: '' | 'medium' | 'low';
  possibleCustomerReason: string;
  customerTier: 'Enterprise' | 'Pro' | '';
  stripeSubscriptionStatus: string;
  arrCustomerName: string;
  accountStatus: '' | 'eligible' | 'opted_out' | 'customer' | 'customer_review' | 'competitor' | 'referral_source';
  accountPriority: '' | 'p0' | 'p1' | 'p2' | 'not_target' | 'excluded';
  icpScore: '' | 1 | 2 | 3 | 4 | 5;
  icpConfidence: '' | 'high' | 'medium' | 'low';
  primaryUseCase: string;
  tvcScore: '' | 1 | 2 | 3 | 4 | 5;
  tvcRelevance: '' | 'high' | 'medium' | 'low';
  tvcFitReason: string;
  icpReasonSummary: string;
  isCompetitor: '' | 'TRUE' | 'FALSE';
  contactScore: '' | 1 | 2 | 3 | 4 | 5;
  contactPriority: '' | 'high' | 'medium' | 'low' | 'exclude';
  roleFit: string;
  contactReasonSummary: string;
  leadPriority: '' | 'direct' | 'queue' | 'hold' | 'do_not_outreach';
  matchMethod: 'exact' | 'redirect' | 'name_match' | 'company_match' | 'fuzzy' | 'no_match';
  matchConfidence: 'high' | 'medium' | 'low' | '';
  sfMatchedDomain: string; // the Sheet15 domain that was actually matched
}

export interface EnrichedRow {
  originalRow: string[];
  domain: string;
  companyName: string;
  match: MatchResult;
}

export interface CompactScoreRow {
  originalRow: string[];
  domain: string;
  companyName: string;
  match: Partial<
    Pick<
      MatchResult,
      | 'sfAccountName'
      | 'sfMatchedDomain'
      | 'sfOptOut'
      | 'sfOptOutSpecificContacts'
      | 'isCustomer'
      | 'accountStatus'
    >
  >;
}

export interface OutboundCandidate {
  key: string;
  firstName: string;
  fullName: string;
  title: string;
  email: string;
  company: string;
  domain: string;
  accountPriority: 'p0' | 'p1' | 'p2';
  contactPriority: 'high' | 'medium' | 'low';
  leadPriority: 'direct' | 'queue';
  primaryUseCase: string;
  icpReasonSummary: string;
  contactReasonSummary: string;
  roleFit: string;
}

export interface OutboundDraft {
  key: string;
  subject: string;
  email1: string;
  email2: string;
  linkedinMessage: string;
  rationale: string;
}

export type MatchStreamEvent =
  | { type: 'progress'; processed: number; total: number }
  | { type: 'complete'; headers: string[]; results: EnrichedRow[]; error?: never }
  | { type: 'error'; error: string };

export type IcpScoreStreamEvent =
  | { type: 'progress'; stage: 'companies' | 'contacts'; processed: number; total: number }
  | { type: 'complete'; results: EnrichedRow[]; error?: never }
  | { type: 'error'; error: string };

export interface IcpJobProgress {
  stage: 'companies' | 'contacts' | 'complete';
  processed: number;
  total: number;
}

export interface IcpJobState {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'error';
  createdAt: string;
  updatedAt: string;
  error: string | null;
  headers: string[];
  rows: EnrichedRow[];
  companyInputs: Array<{
    key: string;
    company: string;
    domain: string;
    rowIndexes: number[];
  }>;
  companyCursor: number;
  contactInputs: Array<{
    key: string;
    companyKey: string;
    name: string;
    title: string;
    email: string;
    company: string;
    domain: string;
    accountPriority: 'p0' | 'p1' | 'p2';
    icpScore: 3 | 4 | 5;
    primaryUseCase: string;
  }>;
  contactCursor: number;
  progress: IcpJobProgress;
}

export interface IcpJobResponse {
  job: Pick<IcpJobState, 'id' | 'status' | 'progress' | 'error' | 'updatedAt'> & {
    results?: EnrichedRow[];
  };
  jobState?: IcpJobState;
}

export type OutboundStreamEvent =
  | { type: 'progress'; processed: number; total: number }
  | { type: 'complete'; drafts: OutboundDraft[]; error?: never }
  | { type: 'error'; error: string };

export interface AccountPitchCandidate {
  key: string;
  company: string;
  domain: string;
  accountPriority: 'p0' | 'p1' | 'p2';
  icpScore: 1 | 2 | 3 | 4 | 5;
  primaryUseCase: string;
  icpReasonSummary: string;
  description: string;
}

export interface AccountPitchDraft {
  key: string;
  company: string;
  pitch: string;
  useCase: string;
  rationale: string;
}

export type AccountPitchStreamEvent =
  | { type: 'progress'; processed: number; total: number }
  | { type: 'complete'; pitches: AccountPitchDraft[]; error?: never }
  | { type: 'error'; error: string };

export interface FuzzyBatchRequest {
  domains: string[];
}

export interface LLMFuzzyMatch {
  unmatched_domain: string;
  matched_domain: string | null;
  confidence: 'medium' | 'low' | null;
  reasoning: string;
}

export interface FuzzyBatchResult {
  // domain → validated MatchResult (using the matched reference domain for lookups)
  matches: Record<string, MatchResult>;
  failedDomains: string[];
  error?: string;
}
