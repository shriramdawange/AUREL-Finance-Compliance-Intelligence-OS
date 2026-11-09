# Supabase backend setup

AUREL intentionally uses a **dedicated Supabase project**. Do not point it at EDU-X, Shelf_v1, CurioLoop, or another unrelated GenSolutions project.

## Current implementation status

- Supabase browser client: implemented with `@supabase/supabase-js@2.119.0`.
- Auth UI: email/password sign-in and sign-up.
- Organisation bootstrap: a signed-in user can create the first organisation and become its owner.
- Tenant access: PostgreSQL RLS helper functions and role-scoped policies are defined in `bootstrap.sql`.
- Document storage: a private `aurel-documents` bucket is defined. Live file upload is wired after authentication.
- Persisted UI adapters: client master, source documents, financial event timeline, tasks and journal list are wired to Supabase.
- Accounting RPC layer: default chart-of-accounts initialisation, balanced journal draft creation, submit/review/approve/post lifecycle, Trial Balance, P&L and Balance Sheet query functions are defined in `core-operations.sql`.
- Journal UI: connected sessions can initialise a starter chart, create a two-line balanced journal draft, submit it for review, approve it and post it. Trial Balance, P&L and Balance Sheet screens query posted journal lines.
- PayPal Edge Functions: sandbox order creation, capture and signed webhook verification are implemented as source code.
- Not yet live: no AUREL-specific Supabase project has been provisioned, no schema has been applied to a remote AUREL database, and no provider secrets have been configured. Live Supabase mode will not work until these steps are completed.

## 1. Create a dedicated project

Use a new Supabase project named **AUREL** in the `gensolutions` organisation and the Mumbai region (`ap-south-1`). The current project-cost quote returned by Supabase was **$0/month**. The project has not yet been created; organisation choice must be confirmed before provisioning.

Do not reuse an existing project from another product.

## 2. Apply the database baseline

In the new project's SQL Editor, run these files in order:

1. `supabase/bootstrap.sql`
2. `supabase/integrity-hardening.sql`
3. `supabase/core-operations.sql`
4. `supabase/verify-core-operations.sql`

The bootstrap transaction creates tenant tables, indexes, RLS policies, private storage bucket and audit triggers. The hardening script adds double-entry journal posting validation and restricts service-only PayPal webhook payloads. The core-operations script adds invoker-rights RPCs for chart-of-accounts initialisation, atomic balanced journal creation, review/approval/posting and posted-ledger Trial Balance, P&L and Balance Sheet queries. The verification script is a non-destructive installation smoke check; it does not replace behavioural tests.

Run the bootstrap exactly once on the new empty project. Apply the next two scripts after it. Confirm the smoke check succeeds. Then run Supabase Security, Performance and Health Advisors and resolve all findings before using real client data.

### Data API exposure

AUREL's browser uses `supabase-js`, which calls the Supabase Data API. Current Supabase projects no longer automatically expose new public tables/functions just because they are created. AUREL scripts include explicit least-privilege grants, but also confirm that the Data API is enabled, `public` is in the exposed schemas, and the required tables/functions show as exposed in the project settings. Keep RLS enabled; a grant only makes an object reachable, while RLS controls which tenant rows the user can access.

The project is not yet linked to local Supabase CLI migration history. Once the dedicated project exists, create and validate a formal versioned migration from this baseline, then keep subsequent schema changes as migrations.

## 3. Configure the frontend

Copy `.env.example` to `.env.local` and set only these browser-safe values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never put the service-role key, database password, PayPal client secret or OCR provider key in a `VITE_*` variable. The publishable key is only safe because all exposed tables have explicit least-privilege grants and RLS policies.

Then run:

```bash
npm install
npm run dev
```

If the variables are absent, AUREL remains in clearly labelled demo mode. If they are present, the app requires authentication and an organisation workspace.

## 4. Configure PayPal Sandbox

Create a PayPal REST app in the PayPal Developer Dashboard and configure these Edge Function secrets:

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
- `PAYPAL_ENVIRONMENT=sandbox`
- `APP_ALLOWED_ORIGINS=https://YOUR-APP-DOMAIN,http://localhost:5173`

Supabase supplies the project URL, publishable/anon key and service-role key to Edge Functions in its runtime. Confirm the actual runtime environment in the Dashboard before deployment; never copy the service-role key into frontend settings.

Deploy from the repository root using the Supabase CLI:

```bash
supabase functions deploy create-paypal-order
supabase functions deploy paypal-webhook --no-verify-jwt
supabase secrets set PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_WEBHOOK_ID=... PAYPAL_ENVIRONMENT=sandbox APP_ALLOWED_ORIGINS=https://YOUR-APP-DOMAIN,http://localhost:5173
```

The webhook function verifies each event using PayPal's `/v1/notifications/verify-webhook-signature` endpoint. Only a verified event matching a stored AUREL payment intent can create a canonical financial event. Unmatched verified webhooks are retained for operator review; they do not create a tenant ledger event.

Register the webhook endpoint:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/paypal-webhook`

Subscribe to at least:

- `PAYMENT.CAPTURE.COMPLETED`
- `PAYMENT.CAPTURE.PENDING`
- `PAYMENT.CAPTURE.DENIED`
- `PAYMENT.CAPTURE.REFUNDED`
- `PAYMENT.CAPTURE.REVERSED`

The create-order function currently supports USD sandbox checkout only. It requires an authenticated owner/admin/manager. It does not support live payments yet.

## 5. Document OCR boundary

The private document storage path and extraction proposal tables are ready. OCR/extraction is **not connected yet**. No file should be treated as an approved accounting record until extraction, validation and human review have been implemented and tested.

## 6. Tenant and accounting safety

- Organisation membership is verified by database policies, not by UI filtering.
- Client, document and event rows carry `organization_id`.
- The storage object path begins with the organisation UUID and the bucket is private.
- Compensation data is restricted to owner/admin/HR roles.
- Financial events and audit events are append-only.
- Posted journal entries cannot be changed; posting requires balanced debit/credit totals.
- Invoice obligation, payment event and receipt evidence remain distinct.
- PayPal transfers, capital, loans and processor fees must not be misclassified as operating revenue or duplicated as expenses.
- GST/tax screens remain workpaper-only; no GSTN filing or tax authority integration is implemented.

## 7. Verification still required

Before handling real records:
1. Apply all four SQL scripts to the dedicated AUREL project and confirm the Data API can reach only the explicitly granted objects.
2. Run Supabase Security, Performance and Health Advisors.
3. Test organisation creation, multi-tenant isolation, membership boundaries and RLS negative cases with two independent users.
4. Test private document upload/download and cross-tenant denial.
5. Run the behavioural cases in `CORE_ACCOUNTING_TEST_PLAN.md`; specifically test idempotent chart initialisation, atomic draft creation, role transitions, balanced posting and report totals.
6. Test PayPal sandbox order approval, capture, denied, refund, reversal, duplicate delivery, unmatched intent, retry after processing failure and invalid signature cases.
7. Add OCR provider, deterministic GST/tax rules, bank imports, period locks, complete reversal workflows, cash-flow classification, accounting adapters, agent tools, monitoring and retention policies.