# Contact–Account Matcher

Enrich contact lists against Salesforce account data. Upload a CSV of contacts → get back account ownership, opt-out status, and fuzzy matches via OpenAI.

## Setup (one-time per machine)

**Requirements:** Node.js 18+, an OpenAI API key (only required for fuzzy matching)

```bash
# 1. Clone and install
git clone <repo-url>
cd contact-matcher
npm install

# 2. Add your OpenAI API key (for fuzzy matching)
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...

# 3. Start
npm run dev
```

Open **http://localhost:5173**

## First run

1. Go to **Salesforce Data** tab
2. Upload `salesforce_all_accounts.csv` (website → account mapping, includes `Stripe ID`)
3. Upload `Opt-out_-_Sales_Opt_out_All.csv` (opt-out list)
4. Optional: upload `Turnkey Topline Metrics.xlsx - Committed ARR.csv` (active customer blacklist by Stripe `Customer ID`)
5. Go to **Match** tab → upload your contact CSV
6. Export enriched CSV when done

Reference data is saved locally in `data/` and persists between sessions. Re-upload when Salesforce data refreshes (~monthly).

## Fuzzy matching

After exact matching completes, click **Run Fuzzy Match** to send unmatched domains to OpenAI for intelligent matching. Each batch of 20 domains takes ~5 seconds. You can cancel mid-run.

Requires `OPENAI_API_KEY` in `.env`.

## Active customers (Committed ARR)

If Committed ARR is uploaded, matched accounts are joined on:
- Salesforce `Stripe ID` (a Stripe `cus_...` customer id)
- ARR `Customer ID`

The results UI defaults to **Customers: Prospects only** (active/past_due customers hidden). Switch to **Active customers** or **All** to review.

## Output columns appended to your CSV

| Column | Description |
|--------|-------------|
| `stripe_customer_id` | Stripe `cus_...` id from Salesforce (used for ARR join) |
| `sf_account_name` | Salesforce account name |
| `sf_account_id` | Salesforce account ID |
| `sf_account_owner` | Account owner |
| `sf_opt_out` | TRUE if account is fully opted out |
| `sf_opt_out_specific_contacts` | TRUE if only specific contacts opted out |
| `sf_opt_out_notes` | Names of opted-out contacts (if specific) |
| `is_active_customer` | TRUE if Committed ARR status is `active` or `past_due` |
| `customer_tier` | `Enterprise` or `Pro` from ARR `Product Name` |
| `stripe_subscription_status` | `active`, `past_due`, `canceled`, etc. (from ARR) |
| `match_method` | `exact` / `fuzzy` / `no_match` |
| `match_confidence` | `high` / `medium` / `low` |
