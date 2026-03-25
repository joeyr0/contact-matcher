# Holdout Scenarios: Phase 4 — Results UI & Export

---

## Scenario 1: Filter to Fuzzy Matches for Manual Review

### Setup
- Matching complete on 800 contacts: 500 exact, 40 fuzzy, 260 no match
- Results table displayed with all 800 rows

### Trigger
User selects "fuzzy" in the match_method filter.

### Expected Flow
1. Table filters to show only 40 rows where `match_method = "fuzzy"`
2. Summary bar updates: "Showing 40 of 800"
3. Each fuzzy row shows a yellow indicator, the matched account name, and the confidence level
4. User can sort by `match_confidence` to review low-confidence matches first
5. User clicks "Export CSV" → downloads ALL 800 rows (not just filtered 40)
6. User clicks "Export Filtered" → downloads only the 40 fuzzy rows

### Satisfaction Criteria
- Filter correctly isolates fuzzy matches
- Summary bar reflects filtered count vs. total
- Default export is ALL rows regardless of filter
- "Export Filtered" option exists and works
- Confidence column sorts correctly: high > medium > low

### Edge Cases
- Multi-select filter: "fuzzy" + "no_match" → shows 300 rows
- Clear all filters → back to 800 rows
- Filter produces 0 results → table shows empty state message

---

## Scenario 2: Identifying Specific-Contact Opt-Outs

### Setup
- Matching complete. One contact matched to Brex:
  - `sf_account_name = "Brex"`
  - `sf_opt_out = "FALSE"`
  - `sf_opt_out_specific_contacts = "TRUE"`
  - `sf_opt_out_notes = "Erika and Tomas"`
  - The contact's name is "Erika Chen"

### Trigger
User is reviewing results to decide who to outreach.

### Expected Flow
1. Contact row shows a distinct indicator — not the full red opt-out flag, but a warning/orange indicator for "specific contacts opted out"
2. Hovering or expanding the row reveals the notes: "Erika and Tomas"
3. User realizes this specific contact (Erika) is named in the opt-out notes
4. The tool does NOT automatically block this contact — it surfaces the information for human judgment

### Satisfaction Criteria
- `sf_opt_out_specific_contacts = TRUE` is visually distinct from `sf_opt_out = TRUE`
- Notes are visible without requiring a separate click (tooltip or inline display)
- The tool does not attempt to name-match the contact against the notes (that's manual review)
- Filtering by "opted out" can optionally include or exclude specific-contact opt-outs

### Edge Cases
- Notes field is blank but `Only opt out specific contacts = TRUE` → indicator shows but no names
- Notes field has multiple names: "Erika and Tomas and Sarah" → full text displayed
- Both `sf_opt_out = TRUE` and `sf_opt_out_specific_contacts = TRUE` → full opt-out takes precedence (red indicator)

---

## Scenario 3: CSV Export Integrity

### Setup
- 1,200 contacts matched. Original CSV had columns: `name`, `first_name`, `last_name`, `email`, `company`, `title`
- Enriched results have 8 additional columns appended

### Trigger
User clicks "Export CSV."

### Expected Flow
1. CSV generated with 1,201 lines (1 header + 1,200 data rows)
2. Header row: `name,first_name,last_name,email,company,title,sf_account_name,sf_account_id,sf_account_owner,sf_opt_out,sf_opt_out_specific_contacts,sf_opt_out_notes,match_method,match_confidence`
3. All original column values preserved exactly (no truncation, no re-encoding)
4. File downloads as `matched-contacts-2026-03-25.csv`
5. File opens correctly in Excel (UTF-8 with BOM)

### Satisfaction Criteria
- Row count matches: input rows = output rows
- Original column order preserved; enriched columns appended at end
- No data corruption: commas in account names are properly CSV-escaped
- File is UTF-8 with BOM for Excel compatibility
- Filename includes today's date

### Edge Cases
- Original CSV had a column with commas in values (e.g., `company = "Acme, Inc."`) → properly quoted in export
- Contact with no match has blank enriched fields (not "undefined" or "null" strings)
- Original CSV had extra columns beyond the expected ones → all preserved in output
