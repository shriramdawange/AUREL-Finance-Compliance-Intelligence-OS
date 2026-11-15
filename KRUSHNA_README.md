# Krushna Retail Suite

Krushna is the retail billing and inventory application area in this repository. AUREL remains available at the root route; Krushna is served at /krushna.

## Implemented browser workflows
- Responsive retail workspace shell and module navigation.
- Product create with SKU/barcode duplicate checks, manual barcode input and EAN-13 generation.
- POS product search and USB/Bluetooth HID keyboard-wedge scanning (scan then Enter).
- Cart quantity editing, intra/inter-state GST split, invoice issue and stock deduction.
- Invoice register and printable invoice using the browser print-to-PDF workflow.
- Supplier and customer master records.
- Purchase capture, goods receipt, stock increase and weighted-average purchase cost.
- Inventory movement ledger, stock valuation and low-stock alerts.
- ITC workpaper register and manual reconciliation status.
- TDS workpaper capture with user-entered section/rate and indicative calculation.
- CSV exports for products, invoices, purchases, stock, ITC and TDS.
- Supabase-backed workspace loading and persistence for products, parties, sales invoices, purchases, stock movements, ITC/TDS workpapers and business profile. The authenticated business is the tenant scope.

## Supabase integration
Dedicated Krushna PostgreSQL schema, RLS, memberships, roles, products, parties, invoice/purchase lines, stock movements, ITC, TDS and audit tables are in supabase/migrations. Transactional RPC source exists for invoice and purchase posting, plus a concurrency-safe invoice sequence allocator. These migrations must be deployed to a dedicated Supabase project and frontend auth/data operations must be connected before multi-user/cloud use. The current browser UI persists to localStorage only.

## Not implemented / not claimed
- No dedicated Supabase project or credentials are provisioned; cloud sync and multi-user mode are not active.
- No GSTN/GSP filing, GSTR portal submission, e-invoice IRN, signed QR or e-way bill integration.
- No automatic GSTR-2B import or statutory ITC eligibility determination.
- TDS thresholds/rates are not a versioned statutory rules engine.
- No payment gateway, WhatsApp/email delivery, cloud document vault or multi-warehouse transfers.
- No production certification or professional tax/legal advice.

## Run locally
Requires Node.js 20+.

    npm install
    npm run dev

Open http://localhost:5173/ for AUREL and http://localhost:5173/krushna for Krushna.

Run checks with npm test and npm run build.

## Dedicated Supabase setup
1. Dedicated project: `krushna-production` (Mumbai region).
2. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in local/preview environments.
3. Never put a service-role key in browser environment variables.
4. Complete authenticated browser tests for onboarding, product creation, purchase receiving, billing, reload persistence and tenant isolation before production use.

## Tax boundary
The current UI calculates basic intra/inter-state GST from configured business and place-of-supply state. It is not a complete GST determination engine. Validate GSTINs, recipient disclosure thresholds, HSN/SAC, exempt/nil/non-GST supplies, composition scheme, exports/SEZ, reverse charge, cess, discounts, tax-inclusive pricing, credit/debit notes and all current notifications before production invoicing. IRN and signed QR must only be shown when returned by an authorised integration.

ITC is a workpaper and must be reconciled against actual GSTR-2B and supporting evidence. TDS section, threshold and rate must be verified for the payment date and facts. Neither module submits statutory returns.

Design reference: https://www.figma.com/design/ghbAeuyVC6CYLiktPyPYgF
