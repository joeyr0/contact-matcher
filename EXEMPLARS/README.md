# Exemplars — Contact-Account Matcher

This directory contains reference patterns and examples for the coding agent.

## Library References

### PapaParse (CSV Parsing)
- **Docs:** https://www.papaparse.com/docs
- **Key usage:** `Papa.parse(file, { header: true, complete: callback })` for reading CSVs; `Papa.unparse(data)` for generating CSVs
- **Critical for:** Handling quoted fields with internal commas (the opt-out multi-domain values like `"oplabs.co,optimism.io"`)

### @vercel/blob (Storage)
- **Docs:** https://vercel.com/docs/vercel-blob
- **Key usage:** `put(pathname, body, { access: 'public' })` for storing; `get(url)` for retrieving
- **Pattern:** Upload raw CSV → parse server-side → store processed JSON index as a blob → retrieve index on subsequent requests

### @tanstack/react-table v8 (Data Table)
- **Docs:** https://tanstack.com/table/latest
- **Key usage:** Headless table with column definitions, sorting state, filter functions, and column visibility
- **Pattern:** Define columns with `createColumnHelper`, use `useReactTable` hook, render with virtualization for 1,000+ rows

### @anthropic-ai/sdk (LLM API)
- **Docs:** https://docs.anthropic.com/en/api/messages
- **Key usage:** `new Anthropic().messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, messages: [...] })`
- **Pattern:** Server-side only (Vercel serverless function), structured JSON output via system prompt

## Architecture Pattern: Per-Batch Client-Driven LLM Calls

For fuzzy matching, avoid running all batches in a single serverless function (risk of timeout). Instead:

```
Client                          Server (/api/fuzzy-match)
  │                                  │
  │ POST batch 1 (20 domains)────────►│
  │                                  │──► Anthropic API call
  │◄─────────── batch 1 results ─────│
  │ update progress (1/8)            │
  │                                  │
  │ POST batch 2 (20 domains)────────►│
  │                                  │──► Anthropic API call
  │◄─────────── batch 2 results ─────│
  │ update progress (2/8)            │
  │ ...                              │
```

This pattern:
- Avoids serverless function timeout (each call is short)
- Provides natural progress updates
- Supports cancellation (client stops sending batches)
- Each function invocation is stateless

## Domain Normalization Reference Implementation

```javascript
// Pseudocode — this is a PATTERN, not copy-paste code
function normalizeDomain(raw) {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');  // strip protocol
  d = d.replace(/^www\./, '');         // strip www
  d = d.replace(/\/.*$/, '');          // strip path
  d = d.replace(/:\d+$/, '');          // strip port
  d = d.trim();
  return d;
}

// For multi-domain values (opt-out CSV):
function normalizeMultiDomain(raw) {
  return raw.split(',')
    .map(d => normalizeDomain(d))
    .filter(d => d.length > 0);
}
```

## Fuzzy Matching Prompt Template

```
System: You are a domain matching assistant for a B2B sales team. Your job is to find the most likely match for unmatched email domains from a reference list of known company domains.

Companies often use multiple domains — different TLDs (.com vs .io vs .xyz), product names vs company names (e.g., optimism.io vs oplabs.co), or regional variants (e.g., ledger.fr vs ledger.com).

RULES:
1. ONLY match to domains that appear in the REFERENCE DOMAINS list below.
2. If no good match exists, return null for the matched field.
3. Never invent or guess domains — only use exact strings from the reference list.
4. Assign confidence: "high" = clearly same company, "medium" = likely same company, "low" = uncertain.

REFERENCE DOMAINS:
{comma_separated_domain_list}

UNMATCHED DOMAINS:
{numbered_list_of_unmatched_domains}

Respond ONLY with a JSON array. No explanation, no markdown fences:
[
  {"unmatched": "example.trade", "matched": "example.xyz", "confidence": "medium", "reasoning": "Same brand, different TLD"},
  {"unmatched": "nocompany.net", "matched": null, "confidence": null, "reasoning": "No plausible match in reference list"}
]
```
