# Contact Matcher — Matching Logic

## What It Does

Takes a CSV of contacts (emails or websites) and enriches each row with Salesforce account data — owner, account name, opt-out status — by matching the contact's domain against the Salesforce reference data.

---

## Matching Pipeline

Each contact runs through the following tiers in order. The first tier that finds a match wins; the rest are skipped.

### Tier 1 — Exact Domain Match
**How:** Extracts the domain from the email (e.g. `ron@acme.com` → `acme.com`) and looks it up directly in the Salesforce accounts index.
**Confidence:** `high`
**Badge:** green
**Example:** `ron@fireblocks.com` → Fireblocks ✓

---

### Tier 1.5 — Domain Root → Account Name
**How:** Strips the TLD from the domain to get a root word (e.g. `blockaid.io` → `blockaid`), then looks that word up against normalized Salesforce account names.
**Confidence:** `medium`
**Badge:** blue
**Example:** `ron@blockaid.io` → root "blockaid" → matches account "Blockaid" → `blockaid.co`
**Guard:** Root must be ≥7 characters. Prevents generic words like "yield", "chain", "token" from matching.

---

### Tier 1.6 — Redirect Follow
**How:** Makes a lightweight HTTP request to the contact's domain and follows any redirects. If the final destination domain is in Salesforce, it's a match.
**Confidence:** `high`
**Badge:** teal
**Example:** `ron@stakek.it` → redirects to `yield.xyz` → yield.xyz is StakeKit in Salesforce ✓
**Note:** Runs all domains in parallel with a 3-second timeout each. Domains that don't redirect are skipped silently.

---

### Tier 1.7 — Company Name Column
**How:** If the contact CSV has a `company` or `organization` column, the company name is normalized and looked up against Salesforce account names directly.
**Confidence:** `medium`
**Badge:** indigo
**Example:** company = "Accenture" → normalized "accenture" → matches Accenture in Salesforce ✓
**Guard:** Name must be ≥7 characters after normalization. A blocklist of crypto-generic words (genesis, balance, polygon, trading, exchange, etc.) are excluded.

---

### Tier 2 — LLM Fuzzy Match *(manual, user-triggered)*
**How:** Sends unmatched domains to GPT-4o-mini in batches of 20. The model is given a pre-filtered list of ~200 candidate Salesforce domains and asked to identify the best match. Every suggestion is validated — if the suggested domain doesn't exist in Salesforce, it's discarded.
**Confidence:** `medium` or `low`
**Badge:** yellow
**Example:** `ron@opentrading.io` → LLM suggests `opentrade.com` → validated in index → match
**Note:** Triggered manually by pressing "Run Fuzzy Match" after the initial results load.

---

### No Match
**How:** All tiers exhausted with no result.
**Confidence:** —
**Badge:** gray

---

## Output Columns Added

| Column | Description |
|--------|-------------|
| `contact_website` | Domain extracted from the uploaded email/website |
| `sf_website` | The Salesforce domain that matched (may differ from contact_website) |
| `sf_account_name` | Salesforce account name |
| `sf_account_id` | Salesforce account ID |
| `sf_account_owner` | Account owner from Salesforce |
| `sf_opt_out` | TRUE / FALSE — full opt-out flag |
| `sf_opt_out_specific_contacts` | TRUE / FALSE — specific contacts only |
| `sf_opt_out_notes` | Notes on who is opted out |
| `match_method` | exact / redirect / name_match / company_match / fuzzy / no_match |
| `match_confidence` | high / medium / low |

**Amber highlight:** When `contact_website` and `sf_website` differ on a medium or low confidence match, the `sf_website` cell is highlighted amber — a prompt to manually verify the match is correct before using.

---

## Confidence Guide

| Confidence | Meaning | Action |
|-----------|---------|--------|
| `high` | Definitive — exact domain or confirmed redirect | Trust it |
| `medium` | Very likely correct — name-based or company-based match | Spot-check amber rows |
| `low` | Possible match — LLM suggestion with lower certainty | Review before use |
| *(blank)* | No match found | Leave or investigate manually |

---

## Opt-Out Row Colors

| Color | Meaning |
|-------|---------|
| Red row | Account is fully opted out of outbound |
| Amber row | Specific contacts opted out — hover row to see names |
