# AUREL core accounting validation plan

These checks must be performed in a non-production AUREL project before any real financial data is entered. The SQL smoke check only verifies installation, RLS flags and function privilege posture; it is not a substitute for behavioural tests.

## Setup

1. Apply `supabase/bootstrap.sql`.
2. Apply `supabase/integrity-hardening.sql`.
3. Apply `supabase/core-operations.sql`.
4. Run `supabase/verify-core-operations.sql`.
5. In Supabase Data API settings, ensure the required `public` objects are exposed to the Data API. Explicit SQL grants and RLS policies remain mandatory.

Create two test organisations with independent users. In organisation A, create one client and initialise its default chart of accounts. Create a second client in the same organisation. Keep organisation B as a separate tenant.

## Chart of accounts

- An owner/admin/manager can initialise the standard chart for a client.
- Running initialisation twice inserts no duplicate account codes.
- A preparer or client_user cannot initialise accounts.
- An account from another client cannot be used to create a journal.

## Journal draft

- A balanced two-line journal creates one draft entry and its two lines atomically.
- A debit/credit mismatch is rejected.
- Zero, negative, both-sided, null or malformed line values are rejected.
- Fewer than two or more than fifty lines are rejected.
- A user from organisation B cannot create or read organisation A's journal.
- A user cannot use an inactive account or an account belonging to a different client.

## Review and posting

- A preparer can submit a draft for review.
- Only owner/admin/manager/reviewer roles can approve a pending journal.
- Only owner/admin/manager roles can post an approved journal.
- An unbalanced journal cannot be posted, even if a caller bypasses the UI and attempts a direct update.
- Posted journals and posted journal lines cannot be edited or deleted.
- A correction must use a reversal/adjustment workflow; do not overwrite a posted source record.

## Bank statement CSV import

- A valid import with one debit and one credit stores both statement lines and emits two canonical financial events.
- The imported rows remain classified as `other`; a credit is not automatically treated as sales revenue.
- A repeated upload using the same statement import ID and stable row IDs creates no duplicate statement lines or financial events.
- Each row has exactly one positive debit or credit amount, an ISO date and non-empty narration.
- Negative amounts, both-sided amounts, zero amounts, malformed dates, duplicate row IDs and invalid account IDs are rejected atomically.
- An account from another organisation or a different client is rejected.
- A user without the permitted organisation role cannot import.

## Sales and purchase trade documents

- A valid sales invoice creates one draft obligation and one line, with customer counterparty details.
- A valid purchase bill creates one draft obligation and one line, with supplier counterparty details.
- Taxable value is calculated server-side from quantity and integer-paise unit rate; tax is split CGST/SGST for intra-state mode or IGST for inter-state mode.
- Zero tax rate remains valid; out-of-range quantity, rate, GST percentage, date, missing counterparty, or invalid tax mode is rejected.
- Duplicate document kind/number within the same client and organisation is rejected by the unique constraint.
- Counterparty records are re-used by organisation, party type and normalized display name.
- The create RPC never inserts a financial event, a receipt, or a journal entry.
- The creator cannot approve their own draft. A different authorised reviewer/owner/admin/manager can approve it.
- Only owner/admin/manager can issue an approved document; the approved values cannot be changed while issuing.
- Document line changes are rejected after the parent document leaves draft.
- Cross-organisation or cross-client IDs must fail.

## General ledger and financial statements

- The general ledger returns only posted journal lines for the selected client and date range.
- Each row uses the account's normal balance direction and includes opening balance and cumulative running balance.
- No draft, pending-review or approved-only journal appears in the general ledger.
- The Trial Balance includes active accounts and balances as of the requested date.
- P&L includes posted income/expense balances in the selected inclusive period.
- Balance Sheet includes posted asset/liability/equity balances plus a derived current-financial-year earnings line, calculated from client financial-year start month.
- For an independently prepared balanced test ledger, total debit balances must equal total credit balances on the Trial Balance.
- Verify that Balance Sheet assets equal liabilities + equity including current-year earnings when opening balances are complete and properly mapped.
- The Cash Flow screen is currently a cash/bank account ledger activity view, not a classified operating/investing/financing cash-flow statement.

## Reports

- Trial Balance includes all active chart accounts with zero balances and only includes posted journals through the as-of date.
- Profit & Loss includes income/expense accounts within the requested inclusive period and excludes drafts/pending/approved journals.
- Balance Sheet includes asset/liability/equity accounts through the as-of date and excludes unposted journals.
- Trial Balance total closing debits equal total closing credits.
- General ledger closing balance agrees with the same account's Trial Balance balance.
- Compare every report total to a manually prepared control example before accepting results.

## Limitations still outstanding

- Period-close locks and prior-period adjustments.
- Retained-earnings / current-year-profit closing logic for a fully balanced Balance Sheet.
- Cash-flow classification and indirect-method reconciliation.
- Source-to-journal automation, reversals and tax-specific posting maps.
- Cash-flow classification, opening balance imports and subledger-to-bank reconciliation.
- Current-year earnings is a derived report line, not a posted closing journal; formal year-end close and retained-earnings transfer logic remain outstanding.
- Trade document approval is an obligation workflow only. Payment matching, partial settlement allocation, overdue ageing and automatic journal posting are separate pending workflows.
- Trade document calculations are arithmetic previews, not a final determination of statutory GST treatment; verify place-of-supply, exemption, HSN/SAC and special-case treatment with current rules.
- Automated pgTAP/CI database tests and independent security review.
