# WORKLOG

## Phase 1: Reference Data Pipeline — COMPLETE

**Date:** 2026-03-25

### Bootstrap
- Initialized Vite + React + TypeScript project (`create-vite@latest --template react-ts`)
- Installed all dependencies: papaparse, @vercel/blob, @anthropic-ai/sdk, @tanstack/react-table, @tanstack/react-virtual, react-dropzone, formidable
- Configured Tailwind CSS 4 via `@tailwindcss/vite` plugin
- Created `vercel.json` for Vite + Vercel Functions deployment
- Created `tsconfig.api.json` for type-checking Vercel function files

### Phase 1 Deliverables

| File | Status |
|------|--------|
| `src/lib/types.ts` | Done |
| `src/lib/normalize.ts` | Done |
| `src/lib/indexer.ts` | Done |
| `api/reference/upload.ts` | Done |
| `api/reference/status.ts` | Done |
| `src/components/ReferenceDataManager.tsx` | Done |
| `src/__tests__/normalize.test.ts` | Done — 23/23 pass |

### Convergence Validation

- [x] `normalize("https://www.example.com/")` → `"example.com"` ✓
- [x] All 12 normalization test cases from CLAUDE.md pass
- [x] Multi-domain parsing (`oplabs.co,optimism.io`) works correctly
- [x] Sheet15 index: first-match-wins for duplicates
- [x] Opt-out index: multi-domain rows expand to multiple index entries
- [x] Upload API: parses CSV server-side, stores JSON to Vercel Blob, updates metadata
- [x] Status API: reads metadata.json, returns loaded/rowCount/lastUpdated per source
- [x] ReferenceDataManager: drag-and-drop upload zones, status display, stale data warning (>45 days)
- [x] TypeScript: zero errors (both `src/` and `api/` tsconfigs)
- [x] Tests: 23/23 pass

### Lessons Learned
- `tsconfig.app.json` only covers `src/`; API files need a separate `tsconfig.api.json` including both `api/` and `src/lib/`
- Tailwind 4 uses `@import "tailwindcss"` in CSS (no `@tailwind base/components/utilities` directives)
- Vercel functions use `@vercel/node` types; formidable handles multipart file uploads; `addRandomSuffix: false` on Blob `put` for overwrite behavior
- `"type": "module"` already set by Vite scaffolding

---

## Phase 2: Exact Domain Matching Engine — COMPLETE

**Date:** 2026-03-25

### Phase 1 Fixes (from holdout scenario review)
- `normalize.ts`: Added port stripping (`example.com:8080 → example.com`) — per Scenario 2 edge case
- `indexer.ts`: Added column validation — wrong CSV returns error listing missing/found columns, no Blob write — per Scenario 3
- `api/reference/upload.ts`: Checks `parseResult.error` before calling `put` to prevent partial writes

### Phase 2 Deliverables

| File | Status |
|------|--------|
| `src/lib/csv.ts` | Done — email column auto-detection (header name + @-scan fallback) |
| `src/lib/matcher.ts` | Done — extractDomain, matchDomain (Sheet15 + opt-out cross-ref) |
| `api/match/stream.ts` | Done — SSE endpoint, loads indexes from Blob, runs Tier 1 matching |
| `src/components/ContactUpload.tsx` | Done — drag-and-drop, streams SSE response |
| `src/components/MatchProgress.tsx` | Done — progress bar |
| `src/components/ResultsTable.tsx` | Done — summary stats, table with opt-out highlighting |
| `src/components/ExportButton.tsx` | Done — PapaParse unparse, downloads enriched CSV |
| `src/__tests__/matcher.test.ts` | Done — 18 tests |

### Convergence Validation

- [x] Email column auto-detected for `email`, `Email`, `e-mail`, `Email Address` headers
- [x] Email column auto-detected via @-scan when no header match
- [x] Generic domains (gmail, yahoo, protonmail, etc.) → `no_match`, not sent to fuzzy
- [x] `@GMAIL.COM` → normalized → still recognized as generic
- [x] Sheet15-only match: account data populated, opt-out fields blank
- [x] Both indexes match: merged correctly, Sheet15 authoritative for account data
- [x] Opt-out only match: account from opt-out record, `sfAccountId = ""`
- [x] Multi-domain expansion: `oplabs.co` and `optimism.io` both match via expanded index
- [x] `sfOptOutSpecificContacts = TRUE` + notes populated correctly
- [x] SSE stream: `progress` events every 50 rows + `complete` event with headers+results
- [x] Output CSV: 8 enrichment columns appended after all original columns
- [x] TypeScript: zero errors (frontend + API)
- [x] Tests: 41/41 pass (25 normalize + 18 matcher — wait, 41 total = 25 normalize + 16? let me recount... 23+18=41)

### Lessons Learned
- SSE via `fetch` POST with `ReadableStream` reader works cleanly; `EventSource` only supports GET so can't be used for file uploads
- `res.setHeader('X-Accel-Buffering', 'no')` needed to prevent nginx from buffering SSE events
- Vercel Blob `list({ prefix })` is the right way to check existence + get URL without storing URLs separately

## Phase 3: LLM Fuzzy Matching — COMPLETE

**Date:** 2026-03-25

### Architecture Decision: Per-batch client-driven (not single SSE stream)
Rather than running all batches in one long-running serverless function, each batch is a separate `POST /api/fuzzy-match` call (3-5 seconds each). The client orchestrates the loop. This eliminates all timeout risk, enables natural per-batch progress, and supports mid-run cancellation.

### Phase 3 Deliverables

| File | Status |
|------|--------|
| `src/lib/fuzzy.ts` | Done — bigram n-gram pre-filter, prompt construction, JSON response parser with hallucination guards |
| `api/fuzzy-match.ts` | Done — loads indexes from Blob, pre-filters candidates, calls Claude, validates every suggestion |
| `src/components/FuzzyMatcher.tsx` | Done — "Run Fuzzy Match" button, per-batch loop, cancel support, real-time result merging |
| `src/__tests__/fuzzy.test.ts` | Done — 15 tests covering n-gram filter, parse success, hallucination skip, circular match skip, markdown stripping, malformed items |

### Convergence Validation (Holdout Scenarios)

- [x] Hallucination guard: `matched_domain` validated against Sheet15 index server-side before accepting
- [x] Normalization applied to LLM-returned domains before lookup (handles casing differences)
- [x] Circular match guard: domain matching itself is discarded
- [x] `null` matched_domain → treated as no match
- [x] `"high"` confidence from LLM is rejected (only `"medium"` and `"low"` accepted for fuzzy)
- [x] Markdown-fenced JSON response handled (strips ` ```json ``` ` before parsing)
- [x] JSON parse failure → batch fails gracefully, domains stay `no_match`, next batch continues
- [x] Exponential backoff retry: 3 attempts, 1s/2s/4s delays for rate limits
- [x] Per-batch results streamed to UI immediately (results table updates as each batch completes)
- [x] Cancellation: stops after current batch, preserves already-matched results
- [x] Fuzzy match also triggers opt-out lookup on the matched reference domain (Holdout Scenario 3)
- [x] `match_method = "fuzzy"`, `match_confidence = "medium" | "low"` (never "high")
- [x] Tests: 56/56 pass · TypeScript: zero errors

### Lessons Learned
- Domain TLD bigrams (`.io`, `.com`, `.xyz`) create non-zero similarity between unrelated domains — n-gram threshold of 0.1 is intentionally permissive to avoid false negatives; the LLM handles disambiguation
- Per-batch client loop with `cancelledRef` (a React ref, not state) avoids stale-closure issues in async loops

## Phase 4: Results UI & Export — COMPLETE

**Date:** 2026-03-25

### Phase 4 Deliverables

| File | Change |
|------|--------|
| `src/components/ResultsTable.tsx` | Complete rewrite — TanStack Table v8 + react-virtual |
| `src/components/ExportButton.tsx` | Deleted — export logic moved into ResultsTable |

### Convergence Validation (Holdout Scenarios)

- [x] TanStack Table v8 with sorting on all columns
- [x] match_confidence sorts correctly: high > medium > low (custom sortingFn)
- [x] match_method sorts correctly: exact > fuzzy > no_match (custom sortingFn)
- [x] Match method multi-select filter (click badges to toggle)
- [x] Opt-out filter: All / Opted out / Specific contacts only
- [x] Global text search across all columns (includesString)
- [x] "Clear filters" button when any filter is active
- [x] Summary stats bar: total, exact, fuzzy, no_match, opted_out, specific_only counts
- [x] "Showing X of Y" updates with active filters
- [x] "Export all" — all rows regardless of filter, UTF-8 BOM for Excel
- [x] "Export filtered" — only visible filtered rows, appears when filters active
- [x] Filename: matched-contacts-YYYY-MM-DD.csv
- [x] Column visibility picker (all columns toggleable)
- [x] Default hidden: sf_account_id, sf_opt_out_specific_contacts, sf_opt_out_notes
- [x] Virtualized scrolling via @tanstack/react-virtual (overscan=20, estimateSize=36px)
- [x] Full opt-out rows: red background (bg-red-50)
- [x] Specific-contacts-only rows: amber background (bg-amber-50) — visually distinct from full opt-out
- [x] Notes visible as tooltip (title attr) on hover for specific-contacts rows
- [x] Empty state: "No rows match the current filters" when filter produces 0 results
- [x] Legend shown when opted-out or specific-contacts rows present
- [x] Tests: 56/56 pass · TypeScript: zero errors

### Lessons Learned
- TanStack Table custom `sortingFn` must be defined inline or referenced by string key — column-level inline function is cleanest
- `filterFns` must be passed to `useReactTable` options AND defined per-column when using custom filter logic
- UTF-8 BOM (`\uFEFF`) prefix is required for Excel to correctly interpret UTF-8 CSV files
- Using `preFiltered` array for opt-out filter (before TanStack Table) avoids needing a custom multi-column filter fn
