# AUREL — Finance & Compliance Intelligence OS

> **Turn source documents and money movement into verified books, compliance workpapers and explainable business decisions.**

AUREL is a finance and compliance operating system for Indian MSMEs, SMEs and the teams that support them. It brings client records, bills, invoices, receipts, payment events and accounting workflows into one evidence-led workspace. It is being built from the workflow lineage of our prior TaxOps OS V5–V8 project: document intake and GST/ITC, tax/TDS workpapers, QC and archive workflows, and secure multi-tenant operations.

## Product principles

1. An invoice is an obligation; it is not proof that cash moved.
2. A payment event is cash movement; it must be linked to the invoice/obligation.
3. A receipt is evidence and must not create a duplicate expense.
4. Cash inflow is not always revenue. Owner capital, loan proceeds and internal transfers are not operating revenue.
5. PayPal gross, fee and net must remain separately traceable.
6. AI may extract, classify, investigate and recommend. Deterministic services calculate amounts; people review and approve high-impact actions.
7. Every financial metric must be traceable to a period, definition, source and coverage status.
8. Tenant/client boundaries are enforced by PostgreSQL RLS and server-side authorization, not just UI filtering.

## Current build

The application is a React + TypeScript + Vite product prototype with a polished enterprise workbench and a Supabase backend foundation.

**Implemented in the repository:**
- Responsive AUREL application shell, navigation, dashboard, charts and module workbenches.
- Client master creation and tenant-aware client-list loading.
- Supabase Auth email/password sign-in/sign-up and first-organisation bootstrap.
- Client/document/event/task/journal data adapters that scope reads to the selected organisation.
- Private `aurel-documents` storage bucket definition and authenticated document upload flow.
- Integer minor-unit money helpers, PayPal gross/fee/net data model and balanced journal validation.
- Multi-tenant PostgreSQL schema, role-aware RLS policies, private storage policies and append-only audit triggers.
- Core accounting RPC source: default chart-of-accounts initialisation, atomic balanced journal draft creation, submit/review/approve/post lifecycle, and posted-ledger Trial Balance, P&L and Balance Sheet queries.
- Connected journal workbench for draft creation and review/post transitions, plus live statement screens when the SQL functions are deployed.
- PayPal sandbox order creation, capture and verified webhook Edge Function source.
- README, Supabase provisioning guide and system architecture documentation.
- GitHub Actions TypeScript and Vite production-build workflow.

**Still prototype/demo-only:**
- Sales/Purchases, Payables/Receivables ageing, automated reconciliation, classified Cash Flow, GST/ITC, TDS/TCS, Income Tax, compliance analytics, forecasts and the AI Agent remain illustrative or unconnected workbenches until their domain services are wired. The live Cash Flow view currently shows cash/bank ledger movements only. General Ledger, Trial Balance, P&L and Balance Sheet have RPC source but require SQL deployment and behavioural validation.
- AUREL Agent responses remain demo-limited; authenticated mode refuses to invent live financial metrics.
- CSV bank import is currently a mapping simulation, not a durable ingestion pipeline.
- Invoice OCR/extraction is not connected. Uploaded source documents remain unclassified until an extraction provider and review service are implemented.
- No GSTN/GSP/ERI connection or authorised tax filing is implemented.
- No live PayPal credentials are present. PayPal functions are source code only until a dedicated Supabase project and Sandbox secrets are configured.

## Architecture overview

```text
Supabase Auth
    ↓
Organisation membership + RLS
    ↓
Clients & Entities
    ↓
Private Document Storage ──> Extraction proposals (future OCR)
    ↓
Canonical Financial Events <── PayPal / Bank / Card / CSV adapters
    ↓
Trade obligations + Event links + Reconciliation
    ↓
Chart of Accounts + Balanced Journals
    ↓
GST / ITC / TDS / Income-tax workpapers
    ↓
Review, approvals, audit trail and archive
    ↓
Curated business metrics → AUREL Agent (read-only tools)
```

See [SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md) and [supabase/README.md](./supabase/README.md).

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

Production build:

```bash
npm run build
npm run preview
```

Without Supabase environment variables, the app opens in clearly labelled demo mode. To enable authentication and the first persisted data adapters:

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Provision a dedicated AUREL Supabase project.
4. Apply `supabase/bootstrap.sql`, then `supabase/integrity-hardening.sql`.
5. Follow [supabase/README.md](./supabase/README.md).

**Never put a Supabase service-role key, database password, PayPal secret or OCR provider key in a `VITE_*` variable.** Edge Function secrets belong in Supabase server-side secrets.

## Supabase status

The source code and SQL baseline are committed, but an AUREL-specific Supabase project has **not** yet been provisioned or migrated. Existing GenSolutions Supabase projects are unrelated products and must not be reused for AUREL.

## Integrations and compliance boundaries

| Integration | Current status | Remaining production work |
|---|---|---|
| Supabase Auth | UI and client wiring implemented | Dedicated project, provider settings, RLS tests and deployment |
| Supabase Database | Baseline schema, RLS and core accounting RPC source committed | Provision project, apply all SQL scripts, expose Data API objects, advisors and integration tests |
| Supabase Storage | Private bucket and upload adapter implemented | Provision bucket, test access denial, retention and malware scanning |
| PayPal | Sandbox create/capture/cancel UI and Edge Function source; retryable signed webhook | Configure REST app, server secrets, webhook subscription, deploy all four functions and run end-to-end Sandbox tests |
| Bank data | CSV mapping simulation | Statement parser, idempotent import, provider/AA connector |
| OCR | Not connected | Provider choice, extraction schema validation, duplicate check and human review |
| GST / ITC | Workpaper prototype | Versioned rules, GSTR-2B data provider, reviewer QC and authorised filing workflow |
| Income tax / TDS | Workpaper prototype | Current tax-year rules, source reconciliation and authorised ERI/portal workflow |

PayPal webhooks are verified server-side against PayPal's signature-verification endpoint before an event can create a financial event. A webhook with no matching stored AUREL payment intent is kept for operator review and does not enter a tenant ledger.

GST/tax modules prepare workpapers only. Filing, verification, OTP/DSC steps and government-system access require taxpayer consent and an authorised provider/professional workflow.

## Repository

The intended source of truth is the `main` branch of this repository. All development changes should be committed here.