# Feature Spec: Phase 4 — Results UI & Export

## 1. Goal

Deliver a polished results experience: an interactive data table with filtering, sorting, visual match-type indicators, and CSV export.

**Concrete deliverables:**
- Results data table with all original + enriched columns
- Color-coded match type indicators: green (exact), yellow (fuzzy), gray (no match), red (opted out)
- Column sorting (click header to sort)
- Filtering: by match method, by opt-out status, by account owner, by search text
- Summary stats bar: X exact, Y fuzzy, Z unmatched, N opted out
- CSV export with all data
- "Run Fuzzy Match" button visible when unmatched results exist and fuzzy pass hasn't run
- Responsive layout for laptop screens (no mobile optimization required)

---

## 2. Exemplar

**Data table:** `@tanstack/react-table` v8 (https://tanstack.com/table/latest) — the standard React data table library. Supports sorting, filtering, pagination, and column visibility. Headless UI approach allows full styling control.

**Design reference:** Clean internal tool aesthetic. Dark sidebar navigation, light content area. Think Linear or Notion's table view — functional, not decorative. Use Tailwind CSS.

---

## 3. Constraints

- **Performance:** Must render 1,500+ rows without lag. Use virtualized scrolling (`@tanstack/react-virtual`) if row count exceeds 500.
- **CSV export:** Generate client-side using PapaParse `unparse()`. Include ALL columns (original + enriched). UTF-8 encoding with BOM for Excel compatibility.
- **Export filename:** `matched-contacts-[YYYY-MM-DD].csv`
- **No pagination required.** Virtualized scrolling is sufficient for 100-2,000 rows.
- **Column visibility:** Users should be able to hide/show columns. Default visible: name fields, email, `sf_account_name`, `sf_account_owner`, `sf_opt_out`, `match_method`, `match_confidence`.
- **Filter state preserved** during session but NOT between sessions.
- **SPA routing** — navigating between tabs (Reference Data, Match, Results) should not reload the page.

---

## 4. Anti-Patterns

- **Do NOT use ag-grid or any paid data grid library.** Use `@tanstack/react-table` (MIT licensed).
- **Do NOT paginate.** Use virtualized scrolling.
- **Do NOT export only visible/filtered rows by default.** Export ALL rows. Optionally offer "Export filtered rows" as secondary.
- **Do NOT build a custom table from scratch.** Use an established table library.
- **Do NOT make the UI mobile-responsive.** Desktop/laptop tool only.
- **Do NOT use a dark theme for the data table.** Light background for readability of dense data.

---

## 5. Scenarios

### Scenario A: Review Fuzzy Matches
- 800 contacts matched: 500 exact, 40 fuzzy, 260 no match
- User filters by match_method = "fuzzy" → sees 40 rows
- Reviews confidence levels, exports full dataset (all 800 rows)

### Scenario B: Find Opted-Out Contacts
- User filters by `sf_opt_out = TRUE` → 30 contacts shown with red indicators
- Sees `sf_opt_out_specific_contacts` and `sf_opt_out_notes` for context
- For Brex: notes say "Erika and Tomas" — account not fully opted out, just those people

### Scenario C: Large Dataset Rendering
- 1,500 contacts, matching complete
- Virtualized scrolling — no lag
- Sort by `sf_account_owner` reorders instantly
- Text search "Duncan" → shows contacts owned by Duncan Acres
- Summary bar: "Showing 85 of 1,500"

---

## 6. Convergence Criteria

- [ ] Results table renders all matched contacts with original + enriched columns
- [ ] Match method indicators are color-coded: green/yellow/gray + red for opted out
- [ ] Column header sorting works (ascending/descending toggle)
- [ ] Filter by match method works (multi-select)
- [ ] Filter by opt-out status works
- [ ] Text search filters across visible columns
- [ ] Summary stats bar shows correct counts, updates with filters
- [ ] CSV export produces valid CSV with all rows and columns
- [ ] Export filename: `matched-contacts-YYYY-MM-DD.csv`
- [ ] Table handles 1,500 rows without scroll lag
- [ ] Column visibility picker works
- [ ] "Run Fuzzy Match" button appears when appropriate
- [ ] UI works on 1280px+ screens
