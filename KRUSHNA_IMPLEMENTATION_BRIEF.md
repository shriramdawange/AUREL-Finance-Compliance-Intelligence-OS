# Krushna Retail & Billing System — Implementation Brief

> Status: initial engineering brief only. This document does not claim that the Krushna product has been implemented.

## Product scope
Krushna is an India-first retail billing, POS, inventory and tax-workflow application based on the separate Krushna Figma Design file: https://www.figma.com/design/ghbAeuyVC6CYLiktPyPYgF

Core target modules:
- Authentication, business onboarding, multi-store workspaces and role-based membership
- Product catalogue, SKU, unique barcode, EAN-13 validation/generation, USB/Bluetooth HID scanner entry, label printing
- POS, cart, payment collection, hold/resume, receipt printing and GST tax invoices
- Customers, suppliers, purchase bills, goods receipt notes and purchase returns
- Inventory ledger, stock count/adjustments/transfers, warehouse balances and weighted-average valuation
- GST sales/purchase registers, Rule 46 invoice validation, ITC vs GSTR-2B reconciliation, TDS workpapers
- Document vault, reporting, settings, team and audit history

## Design source of truth
Use the Figma file's editable screens and design tokens:
- DM Sans type
- Brand green #296B57
- Canvas #F6F8FA
- Cards #FFFFFF
- Text #1A212E and muted #667382
- Border #E0E5EB
- Sidebar 232px, desktop content area, rounded compact cards and clear two-column forms

Relevant Figma frames include dashboard/POS, products & inventory, purchase workflow, print-ready GST invoice, barcode product create, compliance, vault and ITC/TDS.

## Architecture guardrails
- This repo currently contains AUREL Finance & Compliance Intelligence OS. Do not silently overwrite or repurpose AUREL's finance/compliance features.
- The Supabase project documentation says AUREL has no dedicated remote Supabase project provisioned. Do not point Krushna at AUREL or any other unrelated product's Supabase project.
- Prefer a dedicated Krushna database/project once provisioning is explicitly approved.
- Tenant isolation must be enforced by database RLS and server-side authorization, not only UI filtering.
- Use integer paise / decimal-safe calculations; no browser-authoritative totals.
- Invoice sequences must be concurrency-safe and unique per business and FY.
- Every stock event is an immutable stock movement; never silently overwrite balances.
- Issued invoice edits must use credit/debit note or legal correction workflows.
- External integrations (GSTN/GSP, IRN/e-invoice, e-way bill, WhatsApp, payment gateways) must never show fake connected/success states.

## Statutory boundary
Rule 46 fields and conditional IRN/QR behavior require validation against current notified rules and the taxpayer's actual applicability. ITC is not automatically claimable merely because a supplier invoice exists; imported GSTR-2B and evidence need human review. TDS rates/thresholds must be versioned/configurable and reviewed by a qualified operator. This app's workpapers are not equivalent to portal filing or professional certification.

## Engineering delivery checklist
A feature is not complete until:
1. UI has real empty/loading/error/success states.
2. Authenticated server operations enforce tenant and role permissions.
3. Database constraints / indexes / RLS are applied and tested.
4. Monetary and tax calculations are deterministic and unit-tested.
5. Irreversible actions are transactionally safe and idempotent.
6. Audit events and source provenance are retained.
7. Build, tests and security checks pass.
8. README documents deployment, environment variables and external-integration limitations.

## First vertical slice
1. Create project workspace/auth/business profile.
2. Product CRUD with unique per-business SKU/barcode.
3. POS item lookup via search and scanner, tax calculation, checkout and payment allocation.
4. Race-safe GST invoice issuance + printable PDF.
5. Inventory stock movements after sale/purchase.
6. Purchase bill + goods receipt workflow.
7. Tests for tax arithmetic, invoice sequence, tenant isolation, role checks and stock ledger.

## Repository placement
The current branch is `feat/krushna-retail-erp`. Keep the current AUREL `main` branch unchanged. Integration into AUREL `main` should only happen after product-boundary and architecture decisions are reviewed.
