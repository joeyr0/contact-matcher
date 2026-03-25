# Holdout Scenarios: Phase 2 — Exact Domain Matching

---

## Scenario 1: Gmail/Generic Domain Handling

### Setup
- Reference data loaded (both indexes populated)
- Contact CSV with 10 rows including:
  - `joey@gmail.com`
  - `sarah@yahoo.com`
  - `mike@protonmail.com`
  - `nikhil@shinami.com` (real domain in index)

### Trigger
User uploads the contact CSV and runs exact matching.

### Expected Flow
1. Email domains extracted: `gmail.com`, `yahoo.com`, `protonmail.com`, `shinami.com`
2. Generic domain check: `gmail.com`, `yahoo.com`, `protonmail.com` are all in the skip list
3. These three contacts get `match_method = "no_match"` immediately (no index lookup attempted)
4. `shinami.com` is looked up in the domain index → match found
5. Results include all 10 rows; generic email contacts have blank `sf_*` fields

### Satisfaction Criteria
- Generic email contacts are NOT passed to the fuzzy matching pool (they're definitively "no_match")
- `shinami.com` produces an exact match with account data populated
- Summary stats correctly count generic emails as "no match" (not as a separate category)
- Generic email list includes at minimum: gmail.com, yahoo.com, hotmail.com, outlook.com, aol.com, icloud.com, protonmail.com, proton.me

### Edge Cases
- `user@GMAIL.COM` (uppercase) → still recognized as generic after normalization
- `user@mail.google.com` → NOT in the generic list → proceeds to index lookup (may or may not match)
- Contact with empty email field → `match_method = "no_match"`, no error thrown

---

## Scenario 2: Opt-Out Cross-Reference on Exact Match

### Setup
- Domain index contains `matterlabs.dev` → Account: "Matter Labs", Owner: "Duncan Acres"
- Opt-out index contains `matterlabs.dev` → `optOut: true`, `optOutSpecificContacts: false`
- Contact CSV has: `elena@matterlabs.dev`

### Trigger
User uploads contacts and runs exact matching.

### Expected Flow
1. Domain `matterlabs.dev` extracted from email
2. Domain index lookup → match found: account "Matter Labs", owner "Duncan Acres"
3. Opt-out index lookup → match found: `Outbound Opt Out = TRUE`
4. Result row populated:
   - `sf_account_name = "Matter Labs"`
   - `sf_account_owner = "Duncan Acres"`
   - `sf_opt_out = "TRUE"`
   - `sf_opt_out_specific_contacts = "FALSE"`
   - `match_method = "exact"`
   - `match_confidence = "high"`

### Satisfaction Criteria
- Both account data AND opt-out data are populated in a single result row
- Opt-out status is never missed for an exact-matched domain
- Contact is visually flagged as opted out in the results table

### Edge Cases
- Domain in domain index but NOT in opt-out index → `sf_opt_out` fields are blank (assume not opted out)
- Domain in opt-out index but NOT in domain index → still populate account info from opt-out record, `sf_account_id` blank
- Domain in opt-out with `Only opt out specific contacts = TRUE` and `Notes = "Erika and Tomas"` → `sf_opt_out = FALSE` but `sf_opt_out_specific_contacts = TRUE` with notes populated

---

## Scenario 3: Multi-Domain Opt-Out Lookup via Contact Email

### Setup
- Opt-out index contains both `oplabs.co` and `optimism.io` (expanded from the multi-domain entry `"oplabs.co,optimism.io"`)
- Both map to: Account "OP Labs / Optimism", `optOut: true`
- Domain index contains `optimism.io` → Account: "OP Labs / Optimism", ID: "001xxx"
- Contact CSV has: `alice@optimism.io`

### Trigger
User uploads contacts and runs exact matching.

### Expected Flow
1. Domain `optimism.io` extracted
2. Domain index lookup → match found (account data populated including Account ID)
3. Opt-out index lookup for `optimism.io` → match found: `optOut: true`
4. Result: exact match with full account data AND opt-out flagged

### Satisfaction Criteria
- The multi-domain expansion in Phase 1 correctly enables this lookup
- Contact `alice@optimism.io` gets the opt-out flag even though the original CSV row had `"oplabs.co,optimism.io"` as a combined value
- Contact `bob@oplabs.co` would ALSO get the opt-out flag via the same mechanism

### Edge Cases
- Contact domain matches one of the multi-domain entries but the OTHER domain is in the domain index → still gets account data from the domain that IS in the domain index
- Contact domain matches opt-out but not domain index → account info from opt-out only, no Account ID
