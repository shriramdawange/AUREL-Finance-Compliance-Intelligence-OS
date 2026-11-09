# AUREL — System Architecture

## 1. Product model

AUREL is a multi-tenant finance and compliance operating system. Each organisation has client/business entities, team memberships, document sources, trade obligations, cash events, ledgers, tax workpapers, tasks, audit history and reporting metrics. Verified source data should be reused across modules rather than repeatedly uploaded or re-entered.

## 2. Current implementation boundary

**In the codebase now**
- React + TypeScript + Vite application shell.
- Supabase browser client using a publishable key only.
- Email/password authentication UI and organisation bootstrap.
- Tenant-aware client/document/event/task queries.
- Private document upload adapter to the `aurel-documents` bucket.
- SQL baseline with organisation membership, role-aware RLS, core financial/event/document/accounting/tax tables, audit triggers and storage policies.
- PayPal Edge Functions for authenticated sandbox order creation, capture and signed webhook intake.
- Core accounting RPCs for chart initialisation, balanced journal draft creation, review, approval, posting, Trial Balance, P&L and Balance Sheet.

**Not yet deployed**
- No AUREL-specific Supabase project has been provisioned.
- SQL has not been applied to a live AUREL database, and no RLS advisor or negative-access test has run.
- PayPal secrets and webhook ID are not configured; Edge Functions are source-only.
- OCR provider and document extraction worker are not connected.
- Most accounting, tax and analytics workbenches still use labelled prototype/demo data.

## 3. Tenant isolation and authentication

### Organisation bootstrap

A user signs up/signs in through Supabase Auth. The first organisation can be created by an authenticated user; the initial organisation membership must be inserted for the same user with the `owner` role. Subsequent invitations must use an authorised server-side membership workflow.

### RLS

The SQL baseline uses:
- `public.organizations` and `public.organization_members`.
- Non-exposed `private.is_org_member()` and `private.has_org_role()` helper functions.
- `organization_id` on tenant-owned rows.
- Role-scoped read/write policies.
- Private Storage bucket policies where the first path segment is the organisation UUID.
- Separate privileged access for employee compensation data.
- Explicit Data API grants in addition to RLS, because grants and RLS are separate controls.

The helper functions use a fixed empty search path, are stored in a non-exposed schema and always bind membership checks to `auth.uid()`. User-editable metadata is not used for authorization decisions.

## 4. Canonical data flow

```text
Auth / Organisation
       |
Client + Business Entity
       |
Document Inbox --------------------- Financial Source Connectors
       |                             (PayPal / bank / card / CSV)
Private object storage                       |
       |                              Immutable provider events
Extraction proposal (future OCR)             |
       |                                     |
Human validation                              |
       +------------------+------------------+
                          |
                 Canonical financial events
                          |
        Invoice / bill obligations and receipts
                          |
             Event-to-obligation relationships
                          |
         Bank / processor reconciliation review
                          |
              Balanced double-entry journals
                          |
       GST / ITC / TDS / Income-tax workpapers
                          |
            QC / approval / audit snapshots
                          |
            Curated metrics and forecasts
                          |
           AUREL Agent with read-only tools
```

## 5. Core financial distinctions

- **Trade document:** an invoice, bill, credit note or debit note. It represents a commercial obligation or adjustment.
- **Source document:** the original bill, invoice, receipt, statement or notice file held in private storage.
- **Financial event:** the actual source-backed cash movement or processor event.
- **Financial event link:** links a payment to a bill, links a refund to an original event, or links receipt evidence without creating another expense.
- **Journal entry:** a double-entry accounting posting. It is distinct from the source event and must balance before posting.

Cash inflow is not automatically revenue. Owner contributions, loan proceeds and internal transfers are financing/non-operating movements. PayPal gross receipts, fees and net settlements must stay separately traceable. A transfer between a PayPal balance and bank account must not create a second sale or expense.

All currency amounts are integer minor units in the database. The currency code is stored on each record. Financial metrics must not mix currencies without an explicit conversion source and rate date.

## 6. Database domains

The current SQL baseline includes:
- Organisations and memberships
- Clients and counterparties
- Financial accounts
- Source documents and document extraction proposals
- Sales/purchase trade documents and line items
- Financial events and event/document links
- Chart of accounts, journal entries and journal lines
- Bank statement lines and reconciliation matches
- Payment intents and provider webhook event inbox
- GST/ITC/TDS/TCS/income-tax workpapers and exceptions
- Tasks, integrations, audit events and compensation records

The baseline is committed in `supabase/bootstrap.sql`. Journal and provider event integrity controls are in `supabase/integrity-hardening.sql`. The first accounting workflows and statement queries are defined in `supabase/core-operations.sql`; use `supabase/verify-core-operations.sql` as an installation smoke check.

## 7. Document intake and OCR

Current:
1. Authenticated user uploads a file to the private organisation bucket.
2. A source-document row stores file metadata and tenant scope.
3. The document is labelled `uploaded` and remains unclassified.

Future:
1. Server-side malware scan and file validation.
2. OCR/classification provider extracts a versioned structured proposal.
3. Deterministic validators check GSTIN format, dates, invoice number, taxable base and tax arithmetic.
4. Duplicate detection checks file hash and supplier/invoice identity.
5. Human reviewer approves or rejects the proposal.
6. Only an approved extraction can propose a trade document or accounting event.

An extraction proposal is never itself an approved ledger entry.

## 8. PayPal integration

### Create order

`supabase/functions/create-paypal-order`:
- Requires a valid Supabase Auth JWT.
- Checks that the user is an active organisation owner/admin/manager.
- Creates a payment intent in AUREL before contacting PayPal.
- Uses server-side PayPal Client ID/Secret.
- Creates a USD sandbox order with AUREL intent UUID in `custom_id`.
- Stores PayPal order ID and returns the approval URL.
- Does not create a financial event at order creation time.

### Webhook intake

`supabase/functions/paypal-webhook`:
- Has JWT verification disabled only because PayPal cannot send an AUREL Supabase JWT.
- Verifies PayPal transmission headers and payload using the registered webhook ID and PayPal's verify-webhook-signature endpoint.
- Persists verified webhook payloads in a service-role-only table.
- Matches events to a previously stored AUREL payment intent.
- Creates a canonical event only for recognised capture/refund/reversal states.
- Uses provider event and capture resource idempotency constraints.
- Leaves unmatched verified events in an operator-review state.
- Does not trust tenant identifiers supplied by an arbitrary webhook body.

The initial checkout function is USD sandbox only. No live payment or payout capability is enabled.

## 9. Accounting integrity

- Source financial events are append-only.
- Audit events are append-only and server-triggered for key mutations.
- Journal lines can only be changed while their parent journal is a draft.
- A journal cannot enter `posted` unless at least two lines exist, debit total is positive, and debit equals credit.
- Posted journals cannot be edited/deleted; corrections require reversal/adjustment workflows.
- The database uses integer minor units to avoid floating-point currency arithmetic.

Further controls still required include period close/locks, ledger subledger reconciliation, complete reversal relationships, account mapping and automated accounting/tax calculation tests.

## 10. AUREL Agent

The intended agent is a read-only orchestration layer over typed, permission-aware tools such as:
- Get organisation and client metrics for a specified period.
- Explain a cash-flow variance with source references.
- Find duplicate invoice candidates.
- Summarise ITC exceptions and evidence.
- Explain receivable/payable ageing.
- Build a forecast scenario and expose assumptions.

The agent must not write arbitrary SQL, invent a ledger balance, post journals, approve tax workpapers, submit statutory filings or execute money movement. In authenticated mode, the current UI states that live financial agent tools are not connected.

## 11. Security and operational requirements

- Publishable key only in frontend; service-role key and provider secrets stay server-side.
- RLS on all exposed tables, with explicit least-privilege grants.
- Tenant scope enforced by row policies and server-side checks.
- Private document storage, signed URLs and no public document bucket.
- Salary and personal data is role restricted and masked.
- Audit sensitive reads, approvals, exports and integration changes in the production release.
- Rate limit upload and webhook endpoints, retain raw provider events securely and monitor failures.
- Run Security, Performance and Health Advisors after schema deployment.
- Test negative access paths with two users from different organisations.

## 12. Phased roadmap

1. Provision dedicated Supabase project; apply all SQL scripts; expose the required Data API objects; run Advisors and two-tenant RLS tests.
2. Complete client/document/task persistence, signed file preview and a proper client/role invitation workflow.
3. Build OCR extraction, validation, duplicate detection and human review workflow.
4. Complete bank CSV ingestion, statement import records, idempotent canonical events and reconciliation.
5. End-to-end PayPal Sandbox checkout/capture/refund/reversal/retry tests.
6. Complete the accounting engine: journal multi-line editing, review controls, period locks, reversal workflows, opening balances, subledger links, account mapping and cash-flow classification.
7. Verify statement maths, including current-year earnings and retained earnings, with control datasets.
8. Implement GST/ITC and TDS/income-tax rule engines with versioned workpapers, source reconciliation and reviewer checks.
9. Implement compliance calendar, notices, archive, export controls and full audit history.
10. Add curated metric service, forecasts, anomaly detection and read-only AUREL Agent tools with evaluation tests.

A module is complete only when its authorization, domain validation, provenance, deterministic calculations, tests, error handling, audit trail and operational monitoring are in place.