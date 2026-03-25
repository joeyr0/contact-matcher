# Spec 02: Exact Domain Matching Engine

## 1. Goal

Deliver the core Tier 1 matching pipeline. User uploads a contact CSV, the system auto-detects the email column, extracts domains, normalizes them, performs deterministic lookups against both the Sheet15 and opt-out indexes, and returns fully enriched results. This is the highest-value feature — it must be 100% accurate on deterministic lookups.

**Concrete deliverables:**
- `POST /api/match/stream` route handler (SSE) that accepts a contact CSV and runs Tier 1 matching
- `lib/matcher.ts` — core matching logic: email detection, domain extraction, index lookups, result assembly
- `lib/csv.ts` — contact CSV parsing utilities with email column auto-detection
- `lib/types.ts` — TypeScript interfaces for contacts, matches, enriched results
- `ContactUpload` component — drag-and-drop upload with column preview
- `MatchProgress` component — shows matching progress (X of Y contacts processed)
- Enriched CSV generation with all output columns from CLAUDE.md

## 2. Exemplar

- **PapaParse** for CSV parsing (same as Phase 1)
- **Server-Sent Events (SSE)** — use Next.js route handlers with `ReadableStream` to stream progress updates. Pattern: `new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })`.
- **fast-csv** (https://github.com/C2FO/fast-csv) — alternative exemplar for CSV generation on the server side if PapaParse's `unparse` isn't sufficient.

## 3. Constraints

- **Email column auto-detection** must work without user intervention. Strategy:
  1. Check column headers for case-insensitive match: `email`, `e-mail`, `email_address`, `emailaddress`, `Email Address`
  2. If no header match, scan first 10 rows for a column where >80% of values contain `@`
  3. If still no match, surface an error asking the user to identify the email column
- **Must handle 1,000+ contacts.** Tier 1 matching is purely in-memory against pre-built indexes — it should complete in <2 seconds for 1,000 rows.
- **Both indexes must be loaded from Vercel Blob at the start of each match request.** Cache in memory for the duration of the request but don't persist in serverless function memory between invocations.
- **Generic email domains** (gmail.com, etc.) must be detected and skipped — these contacts get `match_method = "no_match"` immediately with no account data.
- **A contact domain can match in Sheet15, opt-out, both, or neither:**
  - Both: merge data. Sheet15 provides account ID/name/owner. Opt-out provides opt-out status/notes.
  - Sheet15 only: account data present, opt-out fields blank (assume NOT opted out).
  - Opt-out only: use opt-out record's account name/owner. Account ID will be blank.
  - Neither: all enrichment fields blank. `match_method = "no_match"`.
- **Output CSV must preserve all original columns** in their original order, with enrichment columns appended.
- **The SSE stream** sends events: `{ type: "progress", processed: N, total: M }` and finally `{ type: "complete", results: [...] }`.

## 4. Anti-Patterns

- **Do NOT compare raw (unnormalized) domains.** Every domain extracted from email goes through `normalize()` before lookup.
- **Do NOT load reference data on every component render.** Load it once when the match request starts.
- **Do NOT return results without the `match_method` column populated.** Every row must have one of: `exact`, `fuzzy`, `no_match`.
- **Do NOT silently fail on malformed email addresses.** If a row has no parseable email, include it in results with all enrichment fields blank and `match_method = "no_match"`.
- **Do NOT run Tier 2 fuzzy matching in this phase.** Unmatched contacts are simply marked `no_match`. Phase 3 adds fuzzy.

## 5. Scenarios

### Scenario A: Standard matching run
**Given** Sheet15 and opt-out data are loaded. Contact CSV has 500 rows, most with company emails.
**When** user uploads the contact CSV
**Then:**
1. System detects the email column automatically
2. Extracts and normalizes domains for all 500 contacts
3. Matches ~60-70% via exact domain lookup in Sheet15
4. For matched contacts, also checks opt-out index
5. Returns enriched CSV with all original columns + 8 new columns
6. Progress stream shows "Processing 100 of 500... 200 of 500..." etc.
7. All exact matches have `match_method = "exact"`, `match_confidence = "high"`

### Scenario B: Contact with gmail.com email
**Given** reference data loaded. Contact row: `John Doe,john@gmail.com`
**When** matching runs
**Then:** `gmail.com` is identified as generic, skipped immediately. Result row has blank enrichment fields and `match_method = "no_match"`.

### Scenario C: Domain in opt-out but not Sheet15
**Given** opt-out list has an account with domain `rareco.xyz` opted out, but `rareco.xyz` is not in Sheet15.
**When** a contact with `alice@rareco.xyz` is processed
**Then:** Match via opt-out index. `sf_account_name` comes from opt-out `Account Name`, `sf_account_owner` from opt-out `Account Owner`, `sf_opt_out = "TRUE"`, `sf_account_id` is blank, `match_method = "exact"`.

## 6. Convergence Criteria

- [ ] Email column auto-detected correctly for CSVs with headers `email`, `Email`, `e-mail`, `Email Address`, and headerless CSVs
- [ ] 100% of domains present in Sheet15 index are matched (zero false negatives on exact match)
- [ ] Generic email domains (gmail, yahoo, hotmail, etc.) are correctly skipped
- [ ] Multi-domain opt-out entries match correctly (e.g., contact with `@optimism.io` matches opt-out record for `"oplabs.co,optimism.io"`)
- [ ] Output CSV has exactly 8 new columns in the correct order
- [ ] All original columns and values are preserved unchanged
- [ ] SSE stream delivers progress events and a complete event
- [ ] 1,000-row contact CSV completes Tier 1 matching in <3 seconds
- [ ] matcher.test.ts has tests for: exact match, no match, generic domain skip, opt-out-only match, both-index match, malformed email handling
