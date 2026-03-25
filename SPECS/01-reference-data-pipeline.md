# Spec 01: Reference Data Pipeline

## 1. Goal

Deliver a working reference data upload and storage system. Users can upload two Salesforce CSV exports (Sheet15 website-to-account mapping, and the Sales Opt-Out list) through the UI. The system parses each CSV, normalizes all domains, builds optimized lookup indexes, and persists them in Vercel Blob. A status endpoint lets the frontend know whether reference data is loaded and when it was last updated.

**Concrete deliverables:**
- `POST /api/reference/upload` route handler that accepts a CSV file + a `type` parameter (`sheet15` or `optout`)
- Domain normalization module (`lib/normalize.ts`) with full test coverage
- Index builder module (`lib/indexer.ts`) that transforms raw CSV rows into `Map<string, Record>` keyed by normalized domain
- `GET /api/reference/status` route handler returning `{ sheet15: { loaded, rowCount, lastUpdated }, optout: { loaded, rowCount, lastUpdated } }`
- `ReferenceDataManager` React component with drag-and-drop upload for each CSV, status display, and replace functionality

## 2. Exemplar

- **PapaParse** (https://github.com/mholt/PapaParse) — the CSV parser to use. Handles quoted fields, BOM, encoding issues, streaming for large files. Use `Papa.parse(file, { header: true })` for both CSVs.
- **Vercel Blob upload pattern** — follow the server upload pattern from Vercel docs: `import { put } from '@vercel/blob'` in the route handler, store parsed JSON (not raw CSV).
- **react-dropzone** (https://github.com/react-dropzone/react-dropzone) — drag-and-drop file upload component. Well-maintained, handles the UI side.

## 3. Constraints

- Sheet15 CSV is ~18,648 rows. Opt-Out CSV is ~3,550 rows. Both must parse in <5 seconds.
- Vercel Blob has a 500MB limit per file and the parsed indexes will be ~2-4MB JSON — well within limits.
- The `metadata.json` blob must track upload timestamps so the UI can show "Last updated: March 15, 2026".
- Multi-domain entries in the opt-out `Website` column (comma-separated like `"oplabs.co,optimism.io"`) must each get their own entry in the opt-out domain index, all pointing back to the same opt-out record.
- Column names must be matched EXACTLY as documented in CLAUDE.md (e.g., `Website__c`, `Account__r.Id`, `Outbound Opt Out`).
- The opt-out index key is the normalized domain. The value includes: `accountName`, `accountOwner`, `optOut` (boolean), `optOutSpecificContacts` (boolean), `notes` (string).
- The Sheet15 index key is the normalized domain. The value includes: `accountId`, `accountName`, `accountOwner`.
- For the 13 duplicate domains in Sheet15, use first-match-wins (first row encountered during parse).

## 4. Anti-Patterns

- **Do NOT store raw CSVs in Blob.** Parse them on upload and store only the normalized JSON indexes. The matching engine reads indexes, not CSVs.
- **Do NOT parse CSVs client-side and send JSON to the server.** Upload the raw file to the server; parsing happens in the route handler. This avoids browser memory issues with large files.
- **Do NOT use a database (Postgres, KV) for reference data.** Vercel Blob is simpler and sufficient for document-shaped data refreshed monthly.
- **Do NOT skip normalization during index building.** Every domain from both CSVs goes through the full normalization pipeline.
- **Do NOT silently drop rows with empty or malformed domains.** Log a warning count and include it in the upload response (e.g., `"skippedRows": 12`).

## 5. Scenarios

### Scenario A: First-time Sheet15 upload
**Given** no reference data has been uploaded yet
**When** the user drags `salesforce_accoutns-_Sheet15.csv` onto the Sheet15 upload zone
**Then** the system:
1. Uploads the file to `POST /api/reference/upload?type=sheet15`
2. Parses all ~18,648 rows with PapaParse
3. Normalizes each `Website__c` value
4. Builds a domain→account Map, first-match-wins for duplicates
5. Stores `sheet15-index.json` in Vercel Blob
6. Updates `metadata.json` with `{ sheet15: { rowCount: 18648, lastUpdated: "2026-03-25T..." } }`
7. Returns `{ success: true, rowCount: 18648, uniqueDomains: 18635, skippedRows: 0 }`
8. The UI shows "Sheet15: 18,648 rows loaded (18,635 unique domains) — Updated just now"

### Scenario B: Opt-out upload with multi-domain entries
**Given** Sheet15 is already uploaded
**When** the user uploads `Opt-out_-_Sales_Opt_out_All.csv` as the opt-out list
**Then** the system:
1. Parses all ~3,550 rows
2. For the row with Website `"oplabs.co,optimism.io"`, creates TWO index entries: `oplabs.co → {optOut: true, ...}` and `optimism.io → {optOut: true, ...}`
3. For the row with Website `"skymavis.com,roninchain.com,axieinfinity.com"`, creates THREE index entries
4. The total domain count in the opt-out index is higher than the row count due to multi-domain expansion
5. Returns accurate counts

### Scenario C: Replacing stale reference data
**Given** both CSVs were uploaded last month
**When** the user uploads a fresh Sheet15 CSV
**Then** the old `sheet15-index.json` blob is overwritten (not duplicated), `metadata.json` timestamp updates, and the UI reflects the new date.

## 6. Convergence Criteria

- [ ] `normalize("https://www.example.com/en")` returns `"example.com"` — pass all normalization test cases from CLAUDE.md
- [ ] Sheet15 index contains exactly 18,635 unique domain keys (for the current dataset)
- [ ] Opt-out index correctly expands multi-domain entries (208 multi-domain rows produce >208 additional index entries)
- [ ] `GET /api/reference/status` returns correct loaded/rowCount/lastUpdated for both data sources
- [ ] Uploading a new CSV overwrites the old blob — no stale data accumulation
- [ ] The ReferenceDataManager component renders upload zones, shows status, handles errors gracefully
- [ ] All normalize.ts unit tests pass (minimum 10 test cases covering protocols, www, paths, whitespace, multi-domain)
