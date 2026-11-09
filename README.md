# AUREL — Finance & Compliance Intelligence OS

> **One intelligence layer for business money, books, tax workpapers and decisions.**

AUREL is a finance and compliance operating system for Indian MSMEs, SMEs and the teams that support them. It connects documents, invoices, payments and accounting records into a traceable workflow for bookkeeping, GST/ITC preparation, tax workpapers, audit evidence and management intelligence.

## Product direction

AUREL is inspired by the documented TaxOps OS V5–V8 workflow lineage:
- V5: document OCR concepts, invoice extraction, auto-accounting, GST and ITC reconciliation.
- V6: income-tax, TDS/TCS and ITR workpaper concepts.
- V7: workflow automation, QC, approvals, client portal and archive.
- V8: multi-tenant security, permissions, audit, jobs and integration foundations.

These are domain references, not imported production services. AUREL consolidates the workflow into one product model.

## Core operating flow

```text
Client & Entity
    ↓
Document Inbox + Financial Sources
    ↓
Classification / Extraction / Validation
    ↓
Canonical Financial Events + Source Evidence
    ↓
Accounting & Reconciliation
    ↓
GST / ITC / TDS / Income-tax Workpapers
    ↓
Quality Checks → Human Review → Approval
    ↓
Authorised Filing / Verification (outside demo scope)
    ↓
Acknowledgement & Archive
    ↓
Business Intelligence & AUREL Agent
```

## Critical data principles

1. **A bill is an obligation, not proof of cash leaving the business.** A successful payment or bank debit represents cash movement. Reconciliation links the two.
2. A receipt is evidence for a transaction; it must not create a second expense.
3. Cash inflow is not always revenue. Owner contributions, loan proceeds and internal transfers are not operating revenue.
4. Transfers between PayPal and a bank account must not be counted twice.
5. PayPal gross receipts, fees and net settlements are separately visible.
6. Refunds and reversals refer to their original event.
7. AI may extract, classify, explain and recommend. Deterministic rules calculate accounting/tax amounts. Humans approve high-impact actions.
8. Every important figure should be traceable to a period, currency, definition, source and coverage status.
9. Salary and employee-sensitive data require role-based visibility and masking.
10. No autonomous payment, payout or statutory filing execution.

## Current repository scope

The initial release is a frontend-first product prototype with clearly labelled fictional/sample data. It is intended to demonstrate the product workflow and UI, not to claim that real financial or government systems are connected.

### Planned/target modules

- Command Centre
- Clients & Entities
- Document Inbox
- Transactions
- Sales & Purchases
- Banking
- Payables & Receivables
- Ledger and Journal Entries
- Trial Balance, Profit & Loss, Balance Sheet and Cash Flow
- Bank Reconciliation
- GST Workbench and ITC Reconciliation
- TDS/TCS and Income Tax Workpapers
- Compliance Calendar and Notices
- Business Insights, Forecasts and Anomalies
- Tasks, Approvals, Audit Trail and Archive
- Integrations and Team Permissions
- AUREL Agent

## Integrations — status boundaries

| Integration | Prototype treatment | Production requirement |
|---|---|---|
| PayPal | Sample sandbox-labelled activity only | Server-side REST app, verified webhooks, idempotency, event backfill and reconciliation |
| Bank | CSV import/mapping workflow | Supported bank-feed/Account Aggregator provider and customer authorisation |
| Documents | Browser upload and sample extraction review | Secure object storage, malware scanning, OCR/extraction service and review queue |
| GST | Workpaper preview and sample reconciliation | Current rules, authorised GSP/ASP route, taxpayer consent and required verification |
| Income tax | Workpaper/QC workflow | Current tax-year rules and authorised ERI/portal integration where applicable |
| Accounting software | Import/export design | Tested provider adapters and controlled mapping |

**No live PayPal, bank, GSTN or income-tax connection is claimed by this prototype.** Never put provider secrets in browser code.

## Technology direction

- Frontend: TypeScript + React
- Build: Vite
- Visualisation: Recharts
- Icons: Lucide React
- Backend direction: typed API services and PostgreSQL
- Database direction: PostgreSQL with tenant-aware data ownership, immutable raw events, accounting journals, audit history and versioned rules
- AI direction: tool-using agent over curated, read-only metrics and evidence references

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Status

This repository is the intended source of truth. UI prototype data is fictional and stored client-side. Authentication, durable persistence, OCR, accounting posting, statutory calculations, real provider adapters, permission enforcement and authorised filing remain backend implementation milestones.

See [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) for the domain model, trust boundaries, workflow and phased roadmap.
