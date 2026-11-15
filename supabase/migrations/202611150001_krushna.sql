-- Krushna Retail Suite: isolated multi-tenant schema.
-- Apply to a DEDICATED Supabase project after reviewing the deployment guide.
create extension if not exists pgcrypto;

create table if not exists public.krushna_businesses (
 id uuid primary key default gen_random_uuid(),
 legal_name text not null,
 trade_name text not null,
 gstin varchar(15),
 address text,
 state_name text not null,
 state_code varchar(2) not null,
 gst_registration_type text not null default 'regular' check (gst_registration_type in ('regular','composition','unregistered')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.krushna_memberships (
 business_id uuid not null references public.krushna_businesses(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('owner','admin','manager','cashier','accountant')),
 created_at timestamptz not null default now(),
 primary key(business_id,user_id)
);
create or replace function public.krushna_is_member(bid uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.krushna_memberships m where m.business_id=bid and m.user_id=auth.uid());
$$;
create or replace function public.krushna_has_role(bid uuid, roles text[])
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.krushna_memberships m where m.business_id=bid and m.user_id=auth.uid() and m.role=any(roles));
$$;

create table if not exists public.krushna_products (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.krushna_businesses(id) on delete cascade,
 name text not null, sku text not null, barcode text, hsn_sac text, unit text not null default 'Nos',
 selling_price numeric(14,2) not null default 0 check(selling_price>=0),
 purchase_cost numeric(14,4) not null default 0 check(purchase_cost>=0),
 gst_rate numeric(5,2) not null default 0 check(gst_rate between 0 and 100),
 stock_qty numeric(14,3) not null default 0, reorder_level numeric(14,3) not null default 0,
 active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(business_id,sku), unique(business_id,barcode)
);
create index if not exists krushna_products_business_name_idx on public.krushna_products(business_id,name);

create table if not exists public.krushna_parties (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.krushna_businesses(id) on delete cascade,
 party_type text not null check(party_type in ('customer','supplier','both')), name text not null,
 gstin varchar(15), pan varchar(10), phone text, email text, address text, state_name text, state_code varchar(2),
 created_at timestamptz not null default now(), unique(business_id,party_type,name)
);
create table if not exists public.krushna_invoice_sequences (
 business_id uuid not null references public.krushna_businesses(id) on delete cascade,
 financial_year text not null, last_number bigint not null default 0,
 primary key(business_id,financial_year)
);
create table if not exists public.krushna_invoices (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.krushna_businesses(id) on delete cascade,
 invoice_number varchar(16) not null, financial_year text not null, invoice_date date not null,
 customer_id uuid references public.krushna_parties(id), customer_name text not null, customer_gstin varchar(15),
 place_of_supply text not null, place_of_supply_code varchar(2), reverse_charge boolean not null default false,
 taxable_value numeric(14,2) not null, cgst numeric(14,2) not null default 0, sgst numeric(14,2) not null default 0,
 igst numeric(14,2) not null default 0, cess numeric(14,2) not null default 0, total numeric(14,2) not null,
 amount_paid numeric(14,2) not null default 0, status text not null default 'issued' check(status in ('issued','paid','part_paid','cancelled')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(business_id,financial_year,invoice_number)
);
create table if not exists public.krushna_invoice_lines (
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.krushna_invoices(id) on delete cascade,
 product_id uuid references public.krushna_products(id), description text not null, hsn_sac text, quantity numeric(14,3) not null,
 unit text not null, unit_price numeric(14,2) not null, discount numeric(14,2) not null default 0,
 taxable_value numeric(14,2) not null, gst_rate numeric(5,2) not null, cgst numeric(14,2) not null default 0,
 sgst numeric(14,2) not null default 0, igst numeric(14,2) not null default 0, cess numeric(14,2) not null default 0
);
create table if not exists public.krushna_purchases (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.krushna_businesses(id) on delete cascade,
 supplier_id uuid references public.krushna_parties(id), supplier_name text not null, supplier_invoice_no text not null,
 invoice_date date not null, taxable_value numeric(14,2) not null, cgst numeric(14,2) not null default 0,
 sgst numeric(14,2) not null default 0, igst numeric(14,2) not null default 0, total numeric(14,2) not null,
 status text not null default 'received' check(status in ('draft','received','cancelled')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(business_id,supplier_name,supplier_invoice_no)
);
create table if not exists public.krushna_purchase_lines (
 id uuid primary key default gen_random_uuid(), purchase_id uuid not null references public.krushna_purchases(id) on delete cascade,
 product_id uuid not null references public.krushna_products(id), quantity numeric(14,3) not null,
 unit_cost numeric(14,4) not null, taxable_value numeric(14,2) not null, gst_rate numeric(5,2) not null
);
create table if not exists public.krushna_stock_movements (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.krushna_businesses(id) on delete cascade,
 product_id uuid not null references public.krushna_products(id), occurred_at timestamptz not null default now(),
 movement_type text not null check(movement_type in ('opening','sale','purchase','sale_return','purchase_return','adjustment','transfer')),
 quantity_delta numeric(14,3) not null check(quantity_delta<>0), reference_type text, reference_id uuid,
 actor_id uuid not null references auth.users(id), note text
);
create index if not exists krushna_stock_movements_product_idx on public.krushna_stock_movements(business_id,product_id,occurred_at desc);

create table if not exists public.krushna_itc_records (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.krushna_businesses(id) on delete cascade,
 supplier_name text not null, supplier_gstin varchar(15), supplier_invoice_no text not null, invoice_date date,
 taxable_value numeric(14,2) not null default 0, cgst numeric(14,2) not null default 0,
 sgst numeric(14,2) not null default 0, igst numeric(14,2) not null default 0,
 source text not null default 'books', reconciliation_status text not null default 'review'
 check(reconciliation_status in ('review','matched','mismatch','missing_in_2b','missing_in_books','ineligible','reversed')),
 eligibility_note text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.krushna_tds_records (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.krushna_businesses(id) on delete cascade,
 payee_name text not null, payee_pan varchar(10), section text not null, payment_date date not null,
 base_amount numeric(14,2) not null, rate numeric(7,4) not null, tds_amount numeric(14,2) not null,
 challan_reference text, deposited_on date, return_period text, certificate_status text not null default 'pending',
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.krushna_audit_log (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.krushna_businesses(id) on delete cascade,
 actor_id uuid not null references auth.users(id), action text not null, entity_type text not null, entity_id uuid,
 detail jsonb not null default '{}', created_at timestamptz not null default now()
);

alter table public.krushna_businesses enable row level security;
alter table public.krushna_memberships enable row level security;
alter table public.krushna_products enable row level security;
alter table public.krushna_parties enable row level security;
alter table public.krushna_invoice_sequences enable row level security;
alter table public.krushna_invoices enable row level security;
alter table public.krushna_invoice_lines enable row level security;
alter table public.krushna_purchases enable row level security;
alter table public.krushna_purchase_lines enable row level security;
alter table public.krushna_stock_movements enable row level security;
alter table public.krushna_itc_records enable row level security;
alter table public.krushna_tds_records enable row level security;
alter table public.krushna_audit_log enable row level security;

drop policy if exists kr_business_read on public.krushna_businesses;
create policy kr_business_read on public.krushna_businesses for select using(public.krushna_is_member(id));
drop policy if exists kr_business_insert on public.krushna_businesses;
create policy kr_business_insert on public.krushna_businesses for insert with check(created_by=auth.uid());
drop policy if exists kr_business_update on public.krushna_businesses;
create policy kr_business_update on public.krushna_businesses for update using(public.krushna_has_role(id,array['owner','admin'])) with check(public.krushna_has_role(id,array['owner','admin']));
drop policy if exists kr_members_read on public.krushna_memberships;
create policy kr_members_read on public.krushna_memberships for select using(public.krushna_is_member(business_id));
drop policy if exists kr_members_manage on public.krushna_memberships;
create policy kr_members_manage on public.krushna_memberships for all using(public.krushna_has_role(business_id,array['owner','admin'])) with check(public.krushna_has_role(business_id,array['owner','admin']));

do $$
declare t text;
begin
 foreach t in array array['krushna_products','krushna_parties','krushna_invoice_sequences','krushna_invoices','krushna_purchases','krushna_stock_movements','krushna_itc_records','krushna_tds_records','krushna_audit_log'] loop
  execute format('drop policy if exists %I on public.%I',t||'_member_all',t);
  execute format('create policy %I on public.%I for all using (public.krushna_is_member(business_id)) with check (public.krushna_is_member(business_id))',t||'_member_all',t);
 end loop;
end $$;
drop policy if exists kr_invoice_lines_access on public.krushna_invoice_lines;
create policy kr_invoice_lines_access on public.krushna_invoice_lines for all
 using(exists(select 1 from public.krushna_invoices i where i.id=invoice_id and public.krushna_is_member(i.business_id)))
 with check(exists(select 1 from public.krushna_invoices i where i.id=invoice_id and public.krushna_is_member(i.business_id)));
drop policy if exists kr_purchase_lines_access on public.krushna_purchase_lines;
create policy kr_purchase_lines_access on public.krushna_purchase_lines for all
 using(exists(select 1 from public.krushna_purchases p where p.id=purchase_id and public.krushna_is_member(p.business_id)))
 with check(exists(select 1 from public.krushna_purchases p where p.id=purchase_id and public.krushna_is_member(p.business_id)));

-- Business creation atomically creates its owner membership.
create or replace function public.krushna_create_business(p_legal_name text,p_trade_name text,p_gstin text,p_address text,p_state text,p_state_code text)
returns uuid language plpgsql security definer set search_path=public as $$
declare bid uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into public.krushna_businesses(legal_name,trade_name,gstin,address,state_name,state_code,created_by)
 values(p_legal_name,p_trade_name,nullif(p_gstin,''),p_address,p_state,p_state_code,auth.uid()) returning id into bid;
 insert into public.krushna_memberships(business_id,user_id,role) values(bid,auth.uid(),'owner');
 return bid;
end $$;
grant execute on function public.krushna_create_business(text,text,text,text,text,text) to authenticated;

-- Race-safe invoice sequence allocation; caller must still validate tax/legal facts.
create or replace function public.krushna_next_invoice_number(p_business_id uuid,p_financial_year text)
returns text language plpgsql security definer set search_path=public as $$
declare n bigint;
begin
 if not public.krushna_has_role(p_business_id,array['owner','admin','manager','cashier']) then raise exception 'Not authorised'; end if;
 insert into public.krushna_invoice_sequences(business_id,financial_year,last_number) values(p_business_id,p_financial_year,1)
 on conflict(business_id,financial_year) do update set last_number=krushna_invoice_sequences.last_number+1
 returning last_number into n;
 return 'KRU/'||p_financial_year||'/'||lpad(n::text,5,'0');
end $$;
grant execute on function public.krushna_next_invoice_number(uuid,text) to authenticated;

-- Immutable audit trail for sensitive master and tax changes.
create or replace function public.krushna_audit_row() returns trigger language plpgsql security definer set search_path=public as $$
declare bid uuid; eid uuid;
begin
 bid:=coalesce((to_jsonb(new)->>'business_id')::uuid,(to_jsonb(old)->>'business_id')::uuid);
 eid:=coalesce((to_jsonb(new)->>'id')::uuid,(to_jsonb(old)->>'id')::uuid);
 insert into public.krushna_audit_log(business_id,actor_id,action,entity_type,entity_id,detail)
 values(bid,auth.uid(),tg_op,tg_table_name,eid,jsonb_build_object('at',now()));
 return coalesce(new,old);
end $$;
drop trigger if exists kr_audit_products on public.krushna_products;
create trigger kr_audit_products after insert or update or delete on public.krushna_products for each row execute function public.krushna_audit_row();
drop trigger if exists kr_audit_itc on public.krushna_itc_records;
create trigger kr_audit_itc after insert or update or delete on public.krushna_itc_records for each row execute function public.krushna_audit_row();
drop trigger if exists kr_audit_tds on public.krushna_tds_records;
create trigger kr_audit_tds after insert or update or delete on public.krushna_tds_records for each row execute function public.krushna_audit_row();

comment on table public.krushna_invoices is 'Issued invoice snapshots. Do not edit issued documents; use credit/debit notes.';
comment on table public.krushna_itc_records is 'ITC workpapers; reconciliation status does not itself establish legal eligibility.';
comment on table public.krushna_tds_records is 'TDS workpapers; statutory rate/threshold applicability must be reviewed for the payment period.';
