# Contact-Account Matcher

## Project Overview

A web application used by Turnkey's revenue team to enrich contact lists against Salesforce account data. Users upload a CSV of contacts, the tool matches email domains against two Salesforce reference datasets (website-to-account mappings and opt-out statuses), then outputs an enriched CSV with account ownership and opt-out information.

**Primary users:** Turnkey revenue team (~5-10 people). Used on-demand before outbound campaigns.

## Tech Stack

- **Frontend:** React 18+ with TypeScript, Next.js (App Router)
- **Hosting:** Vercel (Fluid Compute enabled for serverless functions)
- **Storage:** Vercel Blob (reference CSV persistence between sessions)
- **LLM:** Anthropic API (Claude claude-sonnet-4-20250514) for fuzzy matching
- **Key Libraries:** PapaParse (CSV parsing), TanStack Table (results display)

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND (React + TypeScript + Next.js)                     │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ Reference    │  │ Contact CSV  │  │ Results Table       │ │
│  │ Data Manager │  │ Upload       │  │ + CSV Export        │ │
│  └──────┬──────┘  └──────┬───────┘  └─────────▲───────────┘ │
└─────────┼────────────────┼─────────────────────┼─────────────┘
          │                │                     │
          ▼                ▼                     │
┌─────────────────────────────────────────────────────────────┐
│  API ROUTES (Next.js Route Handlers / Vercel Functions)      │
│                                                              │
│  POST /api/reference/upload  ← parse CSV, normalize, store  │
│  GET  /api/reference/status  ← check if ref data loaded     │
│  POST /api/match/stream      ← SSE-streamed matching        │
└────────────┬──────────────────────────┬─────────────────────┘
             │                          │
             ▼                          ▼
┌────────────────────┐     ┌───────────────────────┐
│  Vercel Blob       │     │  Anthropic API        │
│  sheet15-index.json│     │  Batched fuzzy calls  │
│  optout-index.json │     │  ~20 domains per call │
│  metadata.json     │     │                       │
└────────────────────┘     └───────────────────────┘
```

## Key Commands

```bash
npm run dev              # Next.js dev server with API routes
npm run build            # Production build
vercel --prod            # Deploy to production
npm run test             # Run all tests (Vitest)
npm run lint             # ESLint + TypeScript check
```

## Domain Normalization Rules

All domain comparisons MUST go through normalization. Canonical form: lowercase, no protocol, no www prefix, no trailing slashes, no paths.

```
Input                          → Normalized
https://www.example.com/       → example.com
HTTP://WWW.EXAMPLE.COM         → example.com
www.example.com                → example.com
example.com/en                 → example.com
  example.com  (whitespace)    → example.com
https://www.klar.mx/           → klar.mx
https://www.sarwa.co/en        → sarwa.co
```

**Steps (in order):**
1. Trim whitespace
2. Convert to lowercase
3. Remove protocol (`https://`, `http://`)
4. Remove `www.` prefix
5. Remove trailing path (everything after first `/`)
6. Remove trailing dots

**Multi-domain handling:** Opt-out `Website` column can contain comma-separated domains (e.g., `"oplabs.co,optimism.io"`). Split on commas FIRST, then normalize each. Each maps back to the same opt-out record.

**Generic email domains to SKIP:**
```
gmail.com, yahoo.com, hotmail.com, outlook.com, aol.com, icloud.com,
mail.com, protonmail.com, proton.me, zoho.com, ymail.com, gmx.com,
fastmail.com, tutanota.com, live.com, msn.com, me.com, mac.com
```

## Reference Data Schemas

### Sheet15 (Website-to-Account Mapping)
- **Source:** `salesforce_accoutns-_Sheet15.csv` (~18,648 rows)

| Column | Description |
|--------|-------------|
| `Id` | Salesforce Website record ID |
| `Name` | Website record name |
| `Website__c` | Domain/URL — PRIMARY LOOKUP KEY (requires normalization) |
| `Account__r.Id` | Salesforce Account ID |
| `Account__r.Name` | Account name |
| `Account__r.Owner.Name` | Account owner |

**13 duplicate domains after normalization. Use first match found.**

### Opt-Out List
- **Source:** `Opt-out_-_Sales_Opt_out_All.csv` (~3,550 rows)

| Column | Description |
|--------|-------------|
| `Account Owner` | Owner name |
| `Account Name` | Account name |
| `Website` | Domain(s), can be comma-separated |
| `Outbound Opt Out` | `TRUE` / `FALSE` |
| `Only opt out specific contacts` | `TRUE` / `FALSE` |
| `Notes` | May contain names of specific opted-out contacts |

**Stats:** 570 opted out, 26 specific-contacts-only, 208 multi-domain entries.

## Matching Pipeline

### Tier 1: Exact Domain Match
1. Parse contact CSV, auto-detect email column (by `@` or header)
2. Extract domain (after `@`), normalize
3. Skip generic email domains
4. Look up in Sheet15 index → Account ID, Name, Owner
5. Look up in Opt-Out index → opt-out status, notes
6. If found in opt-out but NOT Sheet15, still return opt-out data
7. `match_method = "exact"`, `match_confidence = "high"`

### Tier 2: LLM Fuzzy Match
1. Collect unmatched non-generic domains
2. Pre-filter candidates per domain using character n-gram similarity (~200-500 candidates)
3. Batch ~20 unmatched domains per LLM call
4. Claude returns JSON suggestions with reasoning
5. **Validate every suggestion — reference domain MUST exist in index**
6. `match_method = "fuzzy"`, `match_confidence = "medium"` or `"low"`

## Output Schema (Enriched CSV)

Original columns preserved. Appended:

| Column | Source |
|--------|--------|
| `sf_account_name` | Sheet15 or Opt-Out account name |
| `sf_account_id` | Sheet15 Account ID (blank if opt-out only match) |
| `sf_account_owner` | Sheet15 or Opt-Out owner |
| `sf_opt_out` | `TRUE` / `FALSE` / blank |
| `sf_opt_out_specific_contacts` | `TRUE` / `FALSE` / blank |
| `sf_opt_out_notes` | Opt-Out Notes field |
| `match_method` | `exact` / `fuzzy` / `no_match` |
| `match_confidence` | `high` / `medium` / `low` |

## Anti-Patterns

- **NEVER** silently present a fuzzy match as exact
- **NEVER** return a fuzzy match for a hallucinated domain
- **NEVER** skip domain normalization for any comparison
- **NEVER** block the UI during LLM processing — use SSE streaming
- **NEVER** hardcode reference data — it comes from uploaded CSVs
- **NEVER** expose Anthropic API key client-side — env var only
- **NEVER** send full 18,600 domain list per LLM call — pre-filter candidates

## Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...
BLOB_READ_WRITE_TOKEN=vercel_blob_...  # Auto-set by Vercel Blob
```

## Project Structure

```
contact-account-matcher/
├── CLAUDE.md
├── package.json / tsconfig.json / next.config.js / vercel.json
├── src/
│   ├── app/
│   │   ├── page.tsx / layout.tsx / globals.css
│   │   └── api/
│   │       ├── reference/upload/route.ts
│   │       ├── reference/status/route.ts
│   │       └── match/stream/route.ts
│   ├── components/
│   │   ├── ReferenceDataManager.tsx
│   │   ├── ContactUpload.tsx
│   │   ├── MatchProgress.tsx
│   │   ├── ResultsTable.tsx
│   │   └── ExportButton.tsx
│   ├── lib/
│   │   ├── normalize.ts / indexer.ts / matcher.ts
│   │   ├── fuzzy.ts / csv.ts / types.ts
│   └── __tests__/
│       ├── normalize.test.ts / matcher.test.ts / fuzzy.test.ts
├── SPECS/
└── holdout-scenarios/
```
