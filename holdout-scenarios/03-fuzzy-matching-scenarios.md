# Holdout Scenarios: Phase 3 — LLM Fuzzy Matching

---

## Scenario 1: Hallucination Prevention

### Setup
- Exact matching complete. Unmatched domains include `avax.network`
- Domain index does NOT contain `avalanche.com` but DOES contain `avax.com`
- Fuzzy matching invoked

### Trigger
User clicks "Run Fuzzy Match" on the results screen.

### Expected Flow
1. `avax.network` is included in a batch sent to the LLM
2. LLM responds with: `{ "unmatched": "avax.network", "matched": "avalanche.com", "confidence": "high", "reasoning": "Avalanche network" }`
3. Server-side validation checks: is `avalanche.com` in the domain index? → NO
4. Match is DISCARDED
5. If LLM also suggested `avax.com` as a secondary match, that IS in the domain index → valid
6. If no valid match found, `avax.network` stays `no_match`

### Satisfaction Criteria
- Hallucinated domain `avalanche.com` is never stored in results
- Validation happens server-side, not relying on LLM honesty
- If a valid alternative was also suggested, it can be used
- Discarded hallucinations are logged for debugging

### Edge Cases
- LLM returns a domain with different capitalization than the index → normalization should handle (compare normalized forms)
- LLM returns the unmatched domain as its own match (circular) → discard
- LLM returns `null` for matched → correctly interpreted as no match

---

## Scenario 2: Batch Processing with Progress

### Setup
- 150 unmatched domains after exact matching
- Fuzzy matching invoked

### Trigger
User clicks "Run Fuzzy Match."

### Expected Flow
1. 150 domains batched into 8 groups of ~20
2. First batch sent → API responds in ~15 seconds → progress: "1/8 batches complete"
3. Each subsequent batch processes sequentially
4. After batch 5, user clicks "Cancel"
5. Batches 1-5 results are preserved. Batches 6-8 domains remain `no_match`
6. Results table updates with partial fuzzy results

### Satisfaction Criteria
- Progress indicator updates after each batch (not just at the end)
- Cancellation preserves already-completed batch results
- Cancelled domains are `no_match`, not errored
- Total processing time for 8 batches: under 5 minutes
- UI remains responsive during processing (not frozen)

### Edge Cases
- Batch 3 fails with API error → retried up to 2 times → if still fails, those 20 domains become `no_match`, processing continues with batch 4
- Rate limit hit → exponential backoff (1s, 2s, 4s) then retry
- All batches fail → user sees "Fuzzy matching failed. X domains remain unmatched." with option to retry

---

## Scenario 3: Fuzzy Match Produces Opt-Out Hit

### Setup
- `haiku.trade` is unmatched after exact matching
- Domain index contains `haiku.xyz` → Account: "Haiku Labs"
- Opt-out index contains `haiku.xyz` → `optOut: true`
- LLM matches `haiku.trade` to `haiku.xyz` with medium confidence

### Trigger
Fuzzy matching batch containing `haiku.trade` completes.

### Expected Flow
1. LLM suggests: `haiku.trade` → `haiku.xyz` (medium confidence)
2. Validation: `haiku.xyz` exists in domain index → valid match
3. Account data populated from domain index lookup on `haiku.xyz`
4. Opt-out check on `haiku.xyz` → opted out
5. Result row:
   - `sf_account_name = "Haiku Labs"`
   - `sf_opt_out = "TRUE"`
   - `match_method = "fuzzy"`
   - `match_confidence = "medium"`

### Satisfaction Criteria
- Fuzzy matches ALSO get opt-out checked (same as exact matches)
- The matched domain (`haiku.xyz`) is used for all index lookups, not the original (`haiku.trade`)
- Result clearly shows this is a fuzzy match with medium confidence
- The opt-out flag is visible alongside the fuzzy match indicator in the results table

### Edge Cases
- Fuzzy match to a domain that's in domain index but NOT in opt-out → opt-out fields blank
- Fuzzy match to a domain that's in opt-out but NOT in domain index → this shouldn't happen (fuzzy matching only matches against domain index domains), but handle gracefully
