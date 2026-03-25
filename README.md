# Contact–Account Matcher

Enrich contact lists against Salesforce account data. Upload a CSV of contacts → get back account ownership, opt-out status, and fuzzy matches via Claude.

## Setup (one-time per machine)

**Requirements:** Node.js 18+, an Anthropic API key

```bash
# 1. Clone and install
git clone <repo-url>
cd contact-matcher
npm install

# 2. Add your Anthropic API key
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# 3. Start
npm run dev
```

Open **http://localhost:5173**

## First run

1. Go to **Reference Data** tab
2. Upload `salesforce_accoutns-_Sheet15.csv` (website → account mapping)
3. Upload `Opt-out_-_Sales_Opt_out_All.csv` (opt-out list)
4. Go to **Match Contacts** tab → upload your contact CSV
5. Export enriched CSV when done

Reference data is saved locally in `data/` and persists between sessions. Re-upload when Salesforce data refreshes (~monthly).

## Fuzzy matching

After exact matching completes, click **Run Fuzzy Match** to send unmatched domains to Claude for intelligent matching. Each batch of 20 domains takes ~5 seconds. You can cancel mid-run.

Requires `ANTHROPIC_API_KEY` in `.env`.

## Output columns appended to your CSV

| Column | Description |
|--------|-------------|
| `sf_account_name` | Salesforce account name |
| `sf_account_id` | Salesforce account ID |
| `sf_account_owner` | Account owner |
| `sf_opt_out` | TRUE if account is fully opted out |
| `sf_opt_out_specific_contacts` | TRUE if only specific contacts opted out |
| `sf_opt_out_notes` | Names of opted-out contacts (if specific) |
| `match_method` | `exact` / `fuzzy` / `no_match` |
| `match_confidence` | `high` / `medium` / `low` |
