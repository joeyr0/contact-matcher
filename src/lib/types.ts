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
  customerMatchMethod: '' | 'stripe_id' | 'account_name' | 'domain_root';
  possibleCustomer: string; // 'TRUE' | 'FALSE' | ''
  possibleCustomerConfidence: '' | 'medium' | 'low';
  possibleCustomerReason: string;
  customerTier: 'Enterprise' | 'Pro' | '';
  stripeSubscriptionStatus: string;
  arrCustomerName: string;
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

export type MatchStreamEvent =
  | { type: 'progress'; processed: number; total: number }
  | { type: 'complete'; headers: string[]; results: EnrichedRow[]; error?: never }
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
