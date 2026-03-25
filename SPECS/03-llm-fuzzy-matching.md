# Spec 03: LLM Fuzzy Matching

## 1. Goal

Add Tier 2 fuzzy matching for contacts that didn't match in Tier 1. After exact matching completes, unmatched domains are batched and sent to the Anthropic API (Claude) for intelligent domain matching. The LLM identifies plausible matches based on brand variations, TLD differences, parent/subsidiary relationships, and acquisitions. Every LLM suggestion is validated against the actual reference index before being accepted.

**Concrete deliverables:**
- `lib/fuzzy.ts` — candidate pre-filtering (n-gram similarity), LLM prompt construction, response parsing, validation
- Integration into `POST /api/match/stream` — Tier 2 runs after Tier 1 completes, using the same SSE stream
- Confidence scoring logic (medium/low based on LLM reasoning)
- Hallucination guard — every suggested match validated against reference index
- Progress reporting: "Fuzzy matching: batch 3 of 12..."

## 2. Exemplar

- **Anthropic Messages API** — use `@anthropic-ai/sdk` npm package. Model: `claude-sonnet-4-20250514`. Structured JSON output via system prompt instructions.
- **String similarity for candidate pre-filtering** — use `string-similarity` npm package (https://github.com/aceakash/string-similarity) or implement bigram/trigram similarity. Goal: reduce 18,600 candidates to ~200-500 per unmatched domain before sending to the LLM.

## 3. Constraints

- **Vercel Pro function timeout:** 800 seconds max with Fluid Compute. A run with 300 unmatched domains at 20 per batch = 15 LLM calls. At ~3-5 seconds per call, this is ~45-75 seconds. Well within limits.
- **Anthropic API rate limits:** Monitor for 429 responses. Implement exponential backoff with 3 retries.
- **Cost awareness:** Each LLM call processes ~20 unmatched domains. At ~2K input tokens + ~500 output tokens per call, a 300-unmatched-domain run costs ~$0.05-0.10. Acceptable for internal tool.
- **Candidate pre-filtering is required.** Sending 18,600 reference domains per LLM call would use ~50K tokens of context just for the domain list. Instead, use character n-gram similarity to send only ~200-500 plausible candidates per batch. This dramatically reduces cost and improves match quality.
- **Output format from LLM must be parseable JSON.** Use a system prompt that strictly specifies the output schema.
- **Confidence levels:**
  - `medium` — LLM identifies same brand, different TLD (e.g., `haiku.trade` → `haiku.xyz`)
  - `low` — LLM identifies likely corporate relationship but less certain (e.g., `avax.network` → `avalabs.com`)

### LLM Prompt Template

```
System: You are a domain matching assistant. You will receive a list of unmatched domains and a list of reference domains from a company database.

Your job: For each unmatched domain, determine if any reference domain belongs to the same company/project.

Match types to look for:
- Same brand, different TLD (e.g., companyname.io vs companyname.com)
- Brand name in different format (e.g., thecompany.com vs company.co)
- Known subsidiaries or product domains (e.g., roninchain.com → skymavis.com)
- Common crypto naming patterns (e.g., protocol.finance → protocol.xyz)

Rules:
- ONLY suggest matches from the reference domain list provided
- NEVER invent or guess domains not in the reference list
- If unsure, do NOT suggest a match — false positives are worse than missed matches
- Rate your confidence: "medium" (same brand, different TLD) or "low" (inferred relationship)

Respond with ONLY a JSON array, no markdown, no explanation:
[
  {
    "unmatched_domain": "example.trade",
    "matched_domain": "example.xyz",
    "confidence": "medium",
    "reasoning": "Same brand name 'example', different TLD"
  }
]

If no matches found for any domain, return an empty array: []
```

## 4. Anti-Patterns

- **Do NOT accept LLM suggestions without validation.** Every `matched_domain` from the LLM response MUST exist in the Sheet15 or opt-out domain index. If it doesn't, discard it — it's a hallucination.
- **Do NOT send the full 18,600 reference domain list to the LLM for every batch.** Pre-filter to ~200-500 candidates using n-gram similarity.
- **Do NOT retry indefinitely on API failures.** Max 3 retries with exponential backoff, then mark remaining domains as `no_match`.
- **Do NOT parse LLM output with regex.** Use `JSON.parse()` inside a try/catch. If parsing fails, treat the batch as unmatched and log the error.
- **Do NOT run fuzzy matching if the user hasn't uploaded reference data.** Check reference data status before starting.
- **Do NOT include domains that already matched in Tier 1 in the fuzzy matching pass.**
- **Do NOT mark fuzzy matches as `match_confidence: "high"`.** Only exact matches get "high".

## 5. Scenarios

### Scenario A: Successful fuzzy match
**Given** Tier 1 completed. Contact with `alice@haiku.trade` is unmatched. Reference index contains `haiku.xyz`.
**When** fuzzy matching runs
**Then:**
1. `haiku.trade` enters the fuzzy pipeline
2. N-gram pre-filter includes `haiku.xyz` in the candidate set (high bigram overlap)
3. LLM returns `{ "unmatched_domain": "haiku.trade", "matched_domain": "haiku.xyz", "confidence": "medium", "reasoning": "Same brand 'haiku', different TLD" }`
4. Validation: `haiku.xyz` exists in Sheet15 index ✓
5. Contact enriched with account data from `haiku.xyz` record
6. `match_method = "fuzzy"`, `match_confidence = "medium"`

### Scenario B: LLM hallucination caught
**Given** Contact with `newstartup.io` is unmatched. Reference index does NOT contain `newstartup.com`.
**When** LLM returns `{ "matched_domain": "newstartup.com", "confidence": "medium" }`
**Then:** Validation fails — `newstartup.com` not in reference index. Match is DISCARDED. Contact remains `match_method = "no_match"`.

### Scenario C: Large batch with progress
**Given** 300 contacts are unmatched after Tier 1. Batch size = 20.
**When** fuzzy matching runs
**Then:**
1. 15 batches are created
2. SSE stream reports: `{ type: "fuzzy_progress", batch: 1, totalBatches: 15 }` through `{ batch: 15, totalBatches: 15 }`
3. Results from all batches are merged with Tier 1 results
4. Final SSE event includes the complete enriched dataset

## 6. Convergence Criteria

- [ ] N-gram pre-filter reduces candidate set from 18,600 to <500 per unmatched domain
- [ ] LLM prompt produces valid JSON output consistently (test with 5+ batch runs)
- [ ] Every LLM-suggested match is validated against reference index — hallucinations are caught and discarded
- [ ] Fuzzy matches have `match_method = "fuzzy"` and `match_confidence` of `"medium"` or `"low"` (never `"high"`)
- [ ] API errors are retried up to 3 times with exponential backoff
- [ ] Failed LLM batches don't crash the entire run — those domains are marked `no_match`
- [ ] SSE stream reports fuzzy matching progress per-batch
- [ ] 300 unmatched domains complete fuzzy matching in <120 seconds
- [ ] fuzzy.test.ts covers: successful match, hallucination rejection, JSON parse failure, API timeout, empty batch
