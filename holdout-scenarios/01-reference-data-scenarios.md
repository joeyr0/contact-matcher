# Holdout Scenarios: Phase 1 — Reference Data Pipeline

---

## Scenario 1: Multi-Domain Opt-Out Entry Expansion

### Setup
- Opt-Out CSV loaded with a row containing: `Website = "oplabs.co,optimism.io"`, `Outbound Opt Out = TRUE`, `Account Name = "OP Labs / Optimism"`, `Account Owner = "Duncan Acres"`
- Domain index already loaded from Sheet15

### Trigger
User uploads the Opt-Out CSV via the reference data upload UI.

### Expected Flow
1. PapaParse reads the quoted `"oplabs.co,optimism.io"` as a single field value (not two columns)
2. Normalization pipeline detects the comma, splits into `["oplabs.co", "optimism.io"]`
3. Each domain is normalized individually (lowercase, strip whitespace)
4. Two entries are created in `optout-index.json`:
   - Key `oplabs.co` → `{ accountName: "OP Labs / Optimism", accountOwner: "Duncan Acres", optOut: true, optOutSpecificContacts: false, notes: "" }`
   - Key `optimism.io` → same record
5. Upload summary reports the multi-domain expansion count

### Satisfaction Criteria
- `optout-index.json` contains both `oplabs.co` and `optimism.io` as separate keys
- Both keys point to identical account data
- The 208 multi-domain entries in the real Opt-Out CSV all expand correctly
- Querying either `oplabs.co` or `optimism.io` later in matching returns the opt-out record

### Edge Cases
- Three-domain entry: `"domain1.com,domain2.io,domain3.xyz"` → three entries
- Multi-domain with spaces: `"oplabs.co, optimism.io"` (space after comma) → both normalized correctly
- Multi-domain with one blank segment: `"oplabs.co,"` → one valid entry, blank segment skipped

---

## Scenario 2: Sheet15 Domain Normalization Across Formats

### Setup
Sheet15 CSV contains domains in varied formats:
- `coindesk.com` (clean)
- `https://legasy.xyz/` (protocol + trailing slash)
- `WWW.SomeCompany.com` (www prefix, mixed case)
- `feedback.brex.com` (subdomain)

### Trigger
User uploads Sheet15 CSV via reference data upload UI.

### Expected Flow
1. Parser reads all 18,648 rows
2. Normalization applied to every `Website__c` value
3. Domain index built with normalized keys
4. 30 duplicate domains detected and logged; first occurrence kept

### Satisfaction Criteria
- `domain-index.json` has key `legasy.xyz` (not `https://legasy.xyz/`)
- `domain-index.json` has key `feedback.brex.com` (subdomain preserved)
- Total unique keys: ~18,618
- Duplicate domain list includes `coindesk.com` (appears twice in real data)

### Edge Cases
- Domain with port: `example.com:8080` → `example.com`
- Domain that is just a protocol: `https://` → skipped with warning
- Domain with path: `https://app.example.com/login` → `app.example.com`

---

## Scenario 3: Column Validation Failure

### Setup
User has a CSV with similar but different column headers: `Id`, `Name`, `Website`, `Account_Id`, `Account_Name`, `Owner`.

### Trigger
User uploads this CSV as Sheet15 reference data.

### Expected Flow
1. Parser reads CSV headers
2. Validation checks for required columns: `Website__c`, `Account__r.Id`, `Account__r.Name`, `Account__r.Owner.Name`
3. None found → error returned listing expected vs. found columns
4. No data stored. Previous reference data unaffected.

### Satisfaction Criteria
- Error message lists ALL missing columns
- Error message lists ALL found columns
- No partial data written to Vercel Blob
- Previously uploaded reference data NOT overwritten
- UI returns to upload state with error displayed

### Edge Cases
- CSV with some required columns present → error lists only the missing ones
- Empty CSV (headers only) → "CSV contains no data rows"
- CSV with correct headers but blank data → "0 valid domains indexed"
