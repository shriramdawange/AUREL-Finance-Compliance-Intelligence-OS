-- AUREL Finance & Compliance Intelligence OS
-- PostgreSQL baseline schema. Apply only to a NEW, dedicated AUREL Supabase project.
-- All currency amounts are integer minor units (e.g. paise for INR, cents for USD).
-- No production data is seeded by this file.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Tenant access helpers. These SECURITY DEFINER functions live in the non-exposed
-- private schema, pin search_path, and always bind authorization to auth.uid().
create or replace function private.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.organization_members m
       where m.organization_id = p_organization_id
         and m.user_id = (select auth.uid())
     );
$$;

create or replace function private.has_org_role(p_organization_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.organization_members m
       where m.organization_id = p_organization_id
         and m.user_id = (select auth.uid())
         and m.role = any(p_roles)
     );
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, text[]) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, text[]) to authenticated, service_role;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  legal_name text,
  country_code char(2) not null default 'IN',
  base_currency char(3) not null default 'INR',
  timezone text not null default 'Asia/Kolkata',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','preparer','reviewer','analyst','client_user','hr')),
  member_status text not null default 'active' check (member_status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  legal_name text not null check (length(trim(legal_name)) between 2 and 200),
  display_name text not null,
  entity_type text not null check (entity_type in ('proprietorship','partnership','llp','company','individual','trust','other')),
  gstin text,
  pan text,
  state text,
  country_code char(2) not null default 'IN',
  annual_turnover_minor bigint not null default 0 check (annual_turnover_minor >= 0),
  relationship_manager text,
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  financial_year_start_month smallint not null default 4 check (financial_year_start_month between 1 and 12),
  status text not null default 'onboarding' check (status in ('active','onboarding','on_hold','review','archived')),
  service_scope text[] not null default array['accounting','gst']::text[],
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index if not exists clients_org_status_idx on public.clients (organization_id, status, created_at desc);

create table if not exists public.counterparties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  display_name text not null,
  legal_name text,
  party_type text not null check (party_type in ('customer','supplier','employee','government','processor','other')),
  gstin text,
  pan text,
  state text,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index if not exists counterparties_org_name_idx on public.counterparties (organization_id, lower(display_name));

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  provider text not null check (provider in ('bank_csv','paypal','card','cash','manual','accounting_import','other')),
  account_label text not null,
  currency_code char(3) not null default 'INR',
  masked_account_reference text,
  account_type text not null default 'operating' check (account_type in ('operating','savings','card','processor_wallet','loan','cash','other')),
  status text not null default 'active' check (status in ('active','disconnected','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict
);
create index if not exists financial_accounts_org_idx on public.financial_accounts (organization_id, status);

create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  original_filename text not null,
  storage_bucket text not null default 'aurel-documents',
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  sha256 text,
  document_type text not null default 'unclassified' check (document_type in ('purchase_invoice','sales_invoice','expense_bill','payment_receipt','bank_statement','credit_note','debit_note','notice','payroll','contract','other','unclassified')),
  document_date date,
  counterparty_name text,
  total_minor bigint check (total_minor is null or total_minor >= 0),
  currency_code char(3) not null default 'INR',
  extraction_confidence numeric(5,2) check (extraction_confidence is null or extraction_confidence between 0 and 100),
  status text not null default 'upload_pending' check (status in ('upload_pending','uploaded','queued','extracting','needs_review','approved','rejected','failed','duplicate','archived')),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, storage_path),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict
);
create index if not exists source_documents_org_status_idx on public.source_documents (organization_id, status, created_at desc);
create index if not exists source_documents_hash_idx on public.source_documents (organization_id, sha256) where sha256 is not null;

create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_document_id uuid not null,
  model_provider text not null default 'not_configured',
  model_name text,
  schema_version text not null default 'gst-invoice-v1',
  extracted_fields jsonb not null default '{}'::jsonb,
  field_confidence jsonb not null default '{}'::jsonb,
  overall_confidence numeric(5,2) check (overall_confidence is null or overall_confidence between 0 and 100),
  validation_errors jsonb not null default '[]'::jsonb,
  review_status text not null default 'proposed' check (review_status in ('proposed','approved','rejected','superseded')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, source_document_id) references public.source_documents(organization_id, id) on delete cascade,
  unique (organization_id, id)
);
create index if not exists document_extractions_doc_idx on public.document_extractions (organization_id, source_document_id, created_at desc);

create table if not exists public.trade_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  counterparty_id uuid,
  source_document_id uuid,
  document_kind text not null check (document_kind in ('sales_invoice','purchase_bill','credit_note','debit_note')),
  document_number text not null,
  document_date date not null,
  due_date date,
  place_of_supply text,
  taxable_minor bigint not null default 0 check (taxable_minor >= 0),
  cgst_minor bigint not null default 0 check (cgst_minor >= 0),
  sgst_minor bigint not null default 0 check (sgst_minor >= 0),
  igst_minor bigint not null default 0 check (igst_minor >= 0),
  cess_minor bigint not null default 0 check (cess_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  settled_minor bigint not null default 0 check (settled_minor >= 0),
  currency_code char(3) not null default 'INR',
  lifecycle_status text not null default 'invoiced' check (lifecycle_status in ('draft','invoiced','approved','partially_paid','paid','overdue','cancelled','reversed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, document_kind, document_number, client_id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, counterparty_id) references public.counterparties(organization_id, id) on delete restrict,
  foreign key (organization_id, source_document_id) references public.source_documents(organization_id, id) on delete restrict,
  check (settled_minor <= total_minor)
);
create index if not exists trade_documents_due_idx on public.trade_documents (organization_id, lifecycle_status, due_date);

create table if not exists public.trade_document_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trade_document_id uuid not null,
  line_number integer not null check (line_number > 0),
  description text not null,
  hsn_sac text,
  quantity numeric(18,4) not null default 1 check (quantity > 0),
  unit_rate_minor bigint not null default 0 check (unit_rate_minor >= 0),
  taxable_minor bigint not null check (taxable_minor >= 0),
  gst_rate numeric(5,2) not null default 0 check (gst_rate between 0 and 100),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, trade_document_id) references public.trade_documents(organization_id, id) on delete cascade,
  unique (trade_document_id, line_number)
);

create table if not exists public.financial_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  financial_account_id uuid,
  counterparty_id uuid,
  source_system text not null check (source_system in ('paypal','bank_csv','card','cash','manual','payroll','accounting_import','other')),
  source_external_id text,
  idempotency_key text not null,
  event_type text not null check (event_type in ('capture','bank_debit','bank_credit','processor_fee','refund','reversal','transfer','owner_contribution','loan_proceeds','loan_principal','tax_payment','payroll_payment','other')),
  cash_direction text not null check (cash_direction in ('inflow','outflow')),
  event_category text not null check (event_category in ('customer_receipt','supplier_payment','operating_expense','processor_fee','tax_payment','payroll','owner_contribution','loan_proceeds','loan_principal','internal_transfer','refund','reversal','other')),
  gross_minor bigint not null check (gross_minor >= 0),
  fee_minor bigint not null default 0 check (fee_minor >= 0),
  net_minor bigint not null check (net_minor >= 0),
  currency_code char(3) not null default 'INR',
  lifecycle_status text not null check (lifecycle_status in ('committed','invoiced','approved','scheduled','processing','paid','reconciled','refunded','reversed','failed')),
  counterparty_name text,
  description text,
  occurred_at timestamptz not null,
  original_event_id uuid,
  provider_event_id text,
  source_payload_hash text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_system, idempotency_key),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, financial_account_id) references public.financial_accounts(organization_id, id) on delete restrict,
  foreign key (organization_id, counterparty_id) references public.counterparties(organization_id, id) on delete restrict,
  foreign key (organization_id, original_event_id) references public.financial_events(organization_id, id) on delete restrict,
  check (fee_minor <= gross_minor),
  check (net_minor = gross_minor - fee_minor)
);
create unique index if not exists financial_events_source_id_idx
  on public.financial_events (organization_id, source_system, source_external_id)
  where source_external_id is not null;
create index if not exists financial_events_org_occurred_idx on public.financial_events (organization_id, occurred_at desc);
create index if not exists financial_events_org_class_idx on public.financial_events (organization_id, event_category, occurred_at desc);

create table if not exists public.financial_event_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  financial_event_id uuid not null,
  trade_document_id uuid,
  source_document_id uuid,
  link_type text not null check (link_type in ('settlement','partial_settlement','refund_of','receipt_evidence','internal_transfer_pair','supporting_evidence')),
  linked_minor bigint check (linked_minor is null or linked_minor >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, financial_event_id) references public.financial_events(organization_id, id) on delete restrict,
  foreign key (organization_id, trade_document_id) references public.trade_documents(organization_id, id) on delete restrict,
  foreign key (organization_id, source_document_id) references public.source_documents(organization_id, id) on delete restrict
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  account_code text not null,
  account_name text not null,
  account_group text not null check (account_group in ('asset','liability','equity','income','expense')),
  normal_balance text not null check (normal_balance in ('debit','credit')),
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, client_id, account_code),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  journal_number text not null,
  journal_date date not null,
  narration text not null,
  source_document_id uuid,
  source_financial_event_id uuid,
  lifecycle_status text not null default 'draft' check (lifecycle_status in ('draft','pending_review','approved','posted','reversed','void')),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, client_id, journal_number),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, source_document_id) references public.source_documents(organization_id, id) on delete restrict,
  foreign key (organization_id, source_financial_event_id) references public.financial_events(organization_id, id) on delete restrict
);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  journal_entry_id uuid not null,
  account_id uuid not null,
  line_number integer not null check (line_number > 0),
  description text,
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, journal_entry_id) references public.journal_entries(organization_id, id) on delete restrict,
  foreign key (organization_id, account_id) references public.accounts(organization_id, id) on delete restrict,
  unique (journal_entry_id, line_number),
  check ((debit_minor > 0 and credit_minor = 0) or (credit_minor > 0 and debit_minor = 0))
);

create table if not exists public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  financial_account_id uuid,
  statement_import_id uuid not null,
  external_line_id text,
  transaction_date date not null,
  narration text not null,
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  currency_code char(3) not null default 'INR',
  source_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, financial_account_id) references public.financial_accounts(organization_id, id) on delete restrict,
  check ((debit_minor > 0 and credit_minor = 0) or (credit_minor > 0 and debit_minor = 0))
);
create index if not exists bank_statement_lines_import_idx on public.bank_statement_lines (organization_id, statement_import_id, transaction_date);

create table if not exists public.reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bank_statement_line_id uuid not null,
  financial_event_id uuid not null,
  matched_minor bigint not null check (matched_minor > 0),
  status text not null default 'suggested' check (status in ('suggested','matched','partial','rejected','mismatch')),
  confidence numeric(5,2) check (confidence is null or confidence between 0 and 100),
  match_reason text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, bank_statement_line_id) references public.bank_statement_lines(organization_id, id) on delete restrict,
  foreign key (organization_id, financial_event_id) references public.financial_events(organization_id, id) on delete restrict
);
create index if not exists reconciliation_matches_org_status_idx on public.reconciliation_matches (organization_id, status, created_at desc);

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  provider text not null default 'paypal' check (provider in ('paypal')),
  provider_order_id text unique,
  provider_capture_id text unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency_code char(3) not null default 'USD',
  description text not null,
  lifecycle_status text not null default 'created' check (lifecycle_status in ('created','approval_pending','approved','captured','partially_refunded','refunded','reversed','failed','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict
);

create table if not exists public.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  verification_status text not null check (verification_status in ('verified','rejected')),
  processing_status text not null default 'received' check (processing_status in ('received','processing','processed','unmatched','ignored','failed')),
  processing_attempts integer not null default 0 check (processing_attempts >= 0),
  processing_started_at timestamptz,
  organization_id uuid,
  payment_intent_id uuid,
  raw_payload jsonb not null,
  processing_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id),
  foreign key (organization_id, payment_intent_id) references public.payment_intents(organization_id, id) on delete restrict
);

create table if not exists public.tax_workpapers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  tax_type text not null check (tax_type in ('gst_gstr1','gst_gstr3b','gst_itc','tds','tcs','income_tax','audit')),
  tax_period text not null,
  financial_year text not null,
  version integer not null default 1 check (version > 0),
  lifecycle_status text not null default 'draft' check (lifecycle_status in ('draft','preparing','needs_review','approved','filed_externally','archived')),
  input_snapshot jsonb not null default '{}'::jsonb,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  source_coverage jsonb not null default '{}'::jsonb,
  prepared_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  external_acknowledgement text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, client_id, tax_type, tax_period, version),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict
);

create table if not exists public.tax_workpaper_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workpaper_id uuid not null,
  exception_code text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  description text not null,
  proposed_action text,
  evidence jsonb not null default '[]'::jsonb,
  lifecycle_status text not null default 'open' check (lifecycle_status in ('open','investigating','resolved','waived')),
  assigned_to uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, workpaper_id) references public.tax_workpapers(organization_id, id) on delete cascade
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid,
  title text not null,
  description text,
  task_type text not null default 'general',
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  lifecycle_status text not null default 'todo' check (lifecycle_status in ('todo','in_progress','awaiting_review','blocked','done','cancelled')),
  assigned_to uuid references auth.users(id) on delete set null,
  reviewer_id uuid references auth.users(id) on delete set null,
  due_at date,
  blocker text,
  source_reference jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict
);
create index if not exists tasks_org_due_idx on public.tasks (organization_id, lifecycle_status, due_at);

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('paypal','bank_csv','gst_gsp','accounting','document_ai','other')),
  display_name text not null,
  connection_status text not null default 'not_connected' check (connection_status in ('not_connected','sandbox','connected','error','revoked')),
  external_account_reference text,
  secret_reference text,
  public_configuration jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, provider, display_name)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  record_type text not null,
  record_id uuid not null,
  action text not null check (action in ('insert','update','delete','approve','reject','export','login','integration_event')),
  before_data jsonb,
  after_data jsonb,
  source_ip inet,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_org_time_idx on public.audit_events (organization_id, created_at desc);

create table if not exists public.compensation_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  employee_reference text not null,
  pay_period date not null,
  gross_minor bigint not null check (gross_minor >= 0),
  deductions_minor bigint not null default 0 check (deductions_minor >= 0),
  net_minor bigint not null check (net_minor >= 0),
  currency_code char(3) not null default 'INR',
  created_at timestamptz not null default now(),
  foreign key (organization_id, client_id) references public.clients(organization_id, id) on delete restrict,
  check (net_minor = gross_minor - deductions_minor)
);
create index if not exists compensation_records_org_period_idx on public.compensation_records (organization_id, pay_period desc);

-- Generic updated_at trigger.
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Audit trigger strips sensitive identifiers and raw document payload details.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_json jsonb;
  new_json jsonb;
  row_json jsonb;
  org_id uuid;
  row_id uuid;
begin
  if tg_op = 'DELETE' then
    old_json := to_jsonb(old) - 'pan' - 'gstin' - 'storage_path' - 'raw_payload';
    row_json := to_jsonb(old);
  else
    new_json := to_jsonb(new) - 'pan' - 'gstin' - 'storage_path' - 'raw_payload';
    row_json := to_jsonb(new);
    if tg_op = 'UPDATE' then
      old_json := to_jsonb(old) - 'pan' - 'gstin' - 'storage_path' - 'raw_payload';
    end if;
  end if;

  org_id := nullif(row_json ->> 'organization_id', '')::uuid;
  row_id := nullif(row_json ->> 'id', '')::uuid;

  if org_id is not null and row_id is not null then
    insert into public.audit_events (
      organization_id, actor_user_id, record_type, record_id, action, before_data, after_data
    ) values (
      org_id, (select auth.uid()), tg_table_name, row_id, lower(tg_op), old_json, new_json
    );
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.prevent_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'This AUREL record is append-only; create a reversal or correction record instead.';
end;
$$;

create or replace function private.prevent_posted_journal_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.lifecycle_status = 'posted' then
    raise exception 'Posted journals are immutable. Create a reversal or adjustment journal.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Update triggers.
do $$
declare t text;
begin
  foreach t in array array['organizations','clients','counterparties','financial_accounts','source_documents','trade_documents','journal_entries','payment_intents','tax_workpapers','tasks','integration_connections'] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t, t);
  end loop;
end $$;

-- Immutable source-event and audit history.
drop trigger if exists financial_events_immutable on public.financial_events;
create trigger financial_events_immutable before update or delete on public.financial_events
for each row execute function private.prevent_immutable_mutation();

drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable before update or delete on public.audit_events
for each row execute function private.prevent_immutable_mutation();

drop trigger if exists posted_journals_immutable on public.journal_entries;
create trigger posted_journals_immutable before update or delete on public.journal_entries
for each row execute function private.prevent_posted_journal_mutation();

-- Capture auditable changes. Audit rows are written by a locked-down trigger function.
do $$
declare t text;
begin
  foreach t in array array['clients','source_documents','trade_documents','financial_events','journal_entries','reconciliation_matches','tax_workpapers','tasks','integration_connections'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update on public.%I for each row execute function private.audit_row_change()', t, t);
  end loop;
end $$;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.audit_row_change() from public, anon, authenticated;
revoke all on function private.prevent_immutable_mutation() from public, anon, authenticated;
revoke all on function private.prevent_posted_journal_mutation() from public, anon, authenticated;

-- RLS everywhere in the exposed public schema.
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','organization_members','clients','counterparties','financial_accounts',
    'source_documents','document_extractions','trade_documents','trade_document_lines',
    'financial_events','financial_event_links','accounts','journal_entries','journal_lines',
    'bank_statement_lines','reconciliation_matches','payment_intents','provider_webhook_events',
    'tax_workpapers','tax_workpaper_exceptions','tasks','integration_connections',
    'audit_events','compensation_records'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Explicit least-privilege Data API grants. New Supabase projects may revoke default grants.
grant select, insert, update on public.organizations to authenticated;
grant select, insert on public.organization_members to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.counterparties to authenticated;
grant select, insert, update on public.financial_accounts to authenticated;
grant select, insert, update on public.source_documents to authenticated;
grant select, insert, update on public.document_extractions to authenticated;
grant select, insert, update on public.trade_documents to authenticated;
grant select, insert, update on public.trade_document_lines to authenticated;
grant select, insert on public.financial_events to authenticated;
grant select, insert on public.financial_event_links to authenticated;
grant select, insert, update on public.accounts to authenticated;
grant select, insert, update on public.journal_entries to authenticated;
grant select, insert, update on public.journal_lines to authenticated;
grant select, insert on public.bank_statement_lines to authenticated;
grant select, insert, update on public.reconciliation_matches to authenticated;
grant select, insert on public.payment_intents to authenticated;
grant select on public.tax_workpapers to authenticated;
grant select, insert, update on public.tax_workpaper_exceptions to authenticated;
grant select, insert, update on public.tasks to authenticated;
grant select, insert, update on public.integration_connections to authenticated;
grant select, insert on public.audit_events to authenticated;
grant select, insert on public.compensation_records to authenticated;
-- provider_webhook_events is service-role only; deliberately no authenticated/anon grants.
grant all on all tables in schema public to service_role;

-- Organization bootstrap: a signed-in user creates an organization then inserts their own owner membership.
create policy organizations_select_member_or_creator on public.organizations
for select to authenticated
using (created_by = (select auth.uid()) or private.is_org_member(id));

create policy organizations_insert_creator on public.organizations
for insert to authenticated
with check (created_by = (select auth.uid()));

create policy organizations_update_admin on public.organizations
for update to authenticated
using (private.has_org_role(id, array['owner','admin']))
with check (private.has_org_role(id, array['owner','admin']));

create policy organizations_delete_owner on public.organizations
for delete to authenticated
using (private.has_org_role(id, array['owner']));

create policy organization_members_select_org on public.organization_members
for select to authenticated
using (user_id = (select auth.uid()) or private.is_org_member(organization_id));

create policy organization_members_bootstrap_owner on public.organization_members
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and role = 'owner'
  and exists (
    select 1 from public.organizations o
    where o.id = organization_id and o.created_by = (select auth.uid())
  )
);

-- Standard membership-scoped read / role-scoped write policies.
create policy clients_select_member on public.clients
for select to authenticated using (private.is_org_member(organization_id));
create policy clients_insert_operator on public.clients
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));
create policy clients_update_operator on public.clients
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']))
with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']));

create policy counterparties_select_member on public.counterparties
for select to authenticated using (private.is_org_member(organization_id));
create policy counterparties_insert_operator on public.counterparties
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));
create policy counterparties_update_operator on public.counterparties
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']))
with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']));

create policy financial_accounts_select_member on public.financial_accounts
for select to authenticated using (private.is_org_member(organization_id));
create policy financial_accounts_insert_admin on public.financial_accounts
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager']));
create policy financial_accounts_update_admin on public.financial_accounts
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager']))
with check (private.has_org_role(organization_id, array['owner','admin','manager']));

create policy source_documents_select_member on public.source_documents
for select to authenticated using (private.is_org_member(organization_id));
create policy source_documents_insert_operator on public.source_documents
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','client_user']));
create policy source_documents_update_reviewer on public.source_documents
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']))
with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']));

create policy document_extractions_select_member on public.document_extractions
for select to authenticated using (private.is_org_member(organization_id));
create policy document_extractions_insert_operator on public.document_extractions
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));
create policy document_extractions_update_reviewer on public.document_extractions
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']))
with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']));

create policy trade_documents_select_member on public.trade_documents
for select to authenticated using (private.is_org_member(organization_id));
create policy trade_documents_insert_operator on public.trade_documents
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));
create policy trade_documents_update_operator on public.trade_documents
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']))
with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']));

create policy trade_document_lines_select_member on public.trade_document_lines
for select to authenticated using (private.is_org_member(organization_id));
create policy trade_document_lines_insert_operator on public.trade_document_lines
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));
create policy trade_document_lines_update_operator on public.trade_document_lines
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']))
with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']));

create policy financial_events_select_member on public.financial_events
for select to authenticated using (private.is_org_member(organization_id));
create policy financial_events_insert_operator on public.financial_events
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));

create policy financial_event_links_select_member on public.financial_event_links
for select to authenticated using (private.is_org_member(organization_id));
create policy financial_event_links_insert_operator on public.financial_event_links
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']));

create policy accounts_select_member on public.accounts
for select to authenticated using (private.is_org_member(organization_id));
create policy accounts_insert_admin on public.accounts
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager']));
create policy accounts_update_admin on public.accounts
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager']))
with check (private.has_org_role(organization_id, array['owner','admin','manager']));

create policy journal_entries_select_member on public.journal_entries
for select to authenticated using (private.is_org_member(organization_id));
create policy journal_entries_insert_operator on public.journal_entries
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));
create policy journal_entries_update_draft on public.journal_entries
for update to authenticated using (
  lifecycle_status <> 'posted'
  and private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer'])
) with check (
  private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer'])
);

create policy journal_lines_select_member on public.journal_lines
for select to authenticated using (private.is_org_member(organization_id));
create policy journal_lines_insert_draft on public.journal_lines
for insert to authenticated with check (
  private.has_org_role(organization_id, array['owner','admin','manager','preparer'])
  and exists (
    select 1 from public.journal_entries j
    where j.id = journal_entry_id and j.organization_id = organization_id and j.lifecycle_status = 'draft'
  )
);
create policy journal_lines_update_draft on public.journal_lines
for update to authenticated using (
  private.has_org_role(organization_id, array['owner','admin','manager','preparer'])
  and exists (
    select 1 from public.journal_entries j
    where j.id = journal_entry_id and j.organization_id = organization_id and j.lifecycle_status = 'draft'
  )
) with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));

create policy bank_statement_lines_select_member on public.bank_statement_lines
for select to authenticated using (private.is_org_member(organization_id));
create policy bank_statement_lines_insert_operator on public.bank_statement_lines
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));

create policy reconciliation_matches_select_member on public.reconciliation_matches
for select to authenticated using (private.is_org_member(organization_id));
create policy reconciliation_matches_insert_operator on public.reconciliation_matches
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));
create policy reconciliation_matches_update_reviewer on public.reconciliation_matches
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']))
with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']));

create policy payment_intents_select_member on public.payment_intents
for select to authenticated using (private.is_org_member(organization_id));
create policy payment_intents_insert_admin on public.payment_intents
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager']));
-- Updates are service-role only after PayPal approval / capture webhooks.

create policy tax_workpapers_select_member on public.tax_workpapers
for select to authenticated using (private.is_org_member(organization_id));
create policy tax_workpaper_exceptions_select_member on public.tax_workpaper_exceptions
for select to authenticated using (private.is_org_member(organization_id));
create policy tax_workpaper_exceptions_insert_operator on public.tax_workpaper_exceptions
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));
create policy tax_workpaper_exceptions_update_reviewer on public.tax_workpaper_exceptions
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']))
with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']));

create policy tasks_select_member on public.tasks
for select to authenticated using (private.is_org_member(organization_id));
create policy tasks_insert_operator on public.tasks
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer']));
create policy tasks_update_operator on public.tasks
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']))
with check (private.has_org_role(organization_id, array['owner','admin','manager','preparer','reviewer']));

create policy integration_connections_select_member on public.integration_connections
for select to authenticated using (private.is_org_member(organization_id));
create policy integration_connections_insert_admin on public.integration_connections
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin']));
create policy integration_connections_update_admin on public.integration_connections
for update to authenticated using (private.has_org_role(organization_id, array['owner','admin']))
with check (private.has_org_role(organization_id, array['owner','admin']));

create policy audit_events_select_member on public.audit_events
for select to authenticated using (private.is_org_member(organization_id));
create policy audit_events_insert_self on public.audit_events
for insert to authenticated with check (
  private.is_org_member(organization_id)
  and (actor_user_id is null or actor_user_id = (select auth.uid()))
);

-- Compensation is restricted to owners, admins, and designated HR staff.
create policy compensation_records_select_privileged on public.compensation_records
for select to authenticated using (private.has_org_role(organization_id, array['owner','admin','hr']));
create policy compensation_records_insert_privileged on public.compensation_records
for insert to authenticated with check (private.has_org_role(organization_id, array['owner','admin','hr']));

-- Private document bucket. Each object path must begin with its organization UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'aurel-documents',
  'aurel-documents',
  false,
  26214400,
  array['application/pdf','image/jpeg','image/png','image/webp','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
on conflict (id) do nothing;

create policy aurel_documents_read_org on storage.objects
for select to authenticated
using (
  bucket_id = 'aurel-documents'
  and case
    when split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
      then private.is_org_member(split_part(name, '/', 1)::uuid)
    else false
  end
);

create policy aurel_documents_upload_org on storage.objects
for insert to authenticated
with check (
  bucket_id = 'aurel-documents'
  and case
    when split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
      then private.has_org_role(split_part(name, '/', 1)::uuid, array['owner','admin','manager','preparer','client_user'])
    else false
  end
);

create policy aurel_documents_update_org on storage.objects
for update to authenticated
using (
  bucket_id = 'aurel-documents'
  and case
    when split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
      then private.has_org_role(split_part(name, '/', 1)::uuid, array['owner','admin','manager','preparer'])
    else false
  end
)
with check (
  bucket_id = 'aurel-documents'
  and case
    when split_part(name, '/', 1) ~ '^[0-9a-fA-F-]{36}$'
      then private.has_org_role(split_part(name, '/', 1)::uuid, array['owner','admin','manager','preparer'])
    else false
  end
);

commit;
