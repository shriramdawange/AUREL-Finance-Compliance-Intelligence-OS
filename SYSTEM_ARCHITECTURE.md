# AUREL system architecture

## 1. Product model

AUREL is a multi-tenant finance and compliance operations product. A client or business entity is onboarded once. Its verified master data and source records are reused across document processing, accounting, reconciliation, tax workpapers, audit packs and business intelligence.

## 2. Core domains

- Organisations, entities, memberships and role-based access
- Clients and counterparty masters
- Documents, extraction proposals, evidence and version history
- Raw financial source events and canonical financial events
- Sales invoices, purchase bills, credit notes and debit notes
- Payment events, receipts, fees, refunds and obligations
- Chart of accounts, journals, journal lines and financial statements
- Bank statement imports and reconciliation decisions
- GST workpapers, purchase registers and ITC matching
- TDS/TCS and income-tax workpapers
- Tasks, approvals, compliance calendar and notices
- Reports, archive snapshots and immutable audit events
- Integrations and AUREL Agent tool calls

## 3. Financial event principles

A document invoice creates or updates an obligation. It does not prove the payment happened. A payment adapter or bank statement creates a cash-movement event. A reconciliation record links the obligation/document and payment event. A receipt is evidence and should not create another expense.

Financial event lifecycle should distinguish committed, invoiced, approved, scheduled, processing, paid, reconciled, refunded, reversed and failed.

Every raw source payload should be retained with source, external ID, idempotency key, timestamp and payload hash. Corrections should be additive adjustments or reversals, not destructive overwrites.

PayPal receipts should preserve gross, fee and net values separately. Transfers from a PayPal balance to a bank account are internal transfers and must not be counted as a second sale. Owner contributions and loan proceeds are financing inflows rather than operating revenue. Loan principal is not the same as interest expense.

## 4. Processing architecture

```text
Bank / PayPal / Card / Payroll / Bills / Receipts / CSV
                       |
                 Source adapters
                       |
             Immutable raw event store
                       |
     Normalize -> Deduplicate -> Resolve party
                       |
      Classify -> Allocate -> Match evidence
                       |
               Review / Approval
                       |
    Ledger | GST/ITC | TDS/Tax | Compliance
                       |
       Curated metrics and report snapshots
                       |
         AUREL Agent (read-only tools)
```

The first frontend prototype uses local sample state only. The production architecture should use a backend API, tenant-aware PostgreSQL database, secure object storage, background jobs, provider adapters, policy checks and append-only audit records.

## 5. AI and trust boundaries

AI may propose document classification, extract invoice fields, suggest a vendor match, explain a variance, draft a checklist and query curated read-only metrics through typed tools. It must not authoritatively calculate tax or accounting totals, write arbitrary SQL, post a journal, submit a statutory return, approve a payment or execute money movement.

Deterministic, versioned calculation services should produce all authoritative amounts. Human review is required for low-confidence extraction, material exceptions, sensitive records and all high-impact workflow actions.

Every metric should carry period, currency, definition, coverage status and source references. If source data is incomplete, the UI should say so rather than invent certainty.

## 6. Security and access

- Tenant and client scope enforced by the API and database; never rely on UI-only filtering.
- Role-based access for owner/admin, manager, preparer, reviewer, analyst and client user.
- Salary and sensitive personal identifiers are masked and separately permissioned.
- Secrets stay server-side in managed secret storage.
- Uploads require malware scanning, size limits and content-type validation.
- Every sensitive read, mutation, approval and export should be audited.
- Period locks and posted journals use controlled reversal/adjustment, not silent mutation.

## 7. GST / tax workflow boundary

AUREL prepares reconciliations and workpapers. Actual filing, verification, OTP/DSC steps and government-system access must follow the current authorised GSP/ASP or ERI / portal process, taxpayer consent and professional/legal requirements. No unofficial scraping or bypass is supported.

## 8. PayPal integration direction

Production PayPal integration should use server-side REST app credentials, Orders/Payments APIs where relevant, verified webhooks, idempotent event ingestion, transaction search/backfill and reconciliation. Webhook signature verification and event replay protection are mandatory. The browser must never contain a PayPal client secret. Current prototype transactions labelled PayPal are fictional demo records only.

## 9. Current implementation status

- Frontend: interactive React + TypeScript prototype with client-side demo state.
- Charts: illustrative cash movement and spend-category views.
- Workflows: add-client, document-upload review, transaction import simulation, reconciliation decision, journal balance check, task completion, CSV export and assistant demo responses.
- Not implemented: authentication, persistent database, OCR service, real bank or PayPal provider, GSTN/GSP/ERI, statutory calculation engine, production journal posting, server-side audit, organisation-level access enforcement or production deployment.

## 10. Phased engineering roadmap

1. Secure tenancy, authentication, organisation and client master.
2. Immutable document and raw-event ingestion with idempotency.
3. Extraction pipeline and human review queue.
4. Canonical ledger and double-entry accounting engine.
5. Bank, card and PayPal adapters with reconciliation.
6. GST / ITC rule sets, GSTR workpapers and exception management.
7. TDS/TCS and income-tax workpapers.
8. Compliance tasks, approvals, notice workflows, archive and reports.
9. Curated business metrics, forecasting and anomaly detection.
10. AUREL read-only agent with typed tools, evidence citations and evaluation.

## 11. Definition of done

A module is not complete because a screen exists. It must have domain validation, tenant/client authorization, traceable inputs, deterministic calculations, audit events, tests, error handling, operational monitoring and documented integration boundaries.
