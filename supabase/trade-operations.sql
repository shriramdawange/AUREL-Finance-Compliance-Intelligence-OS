-- AUREL trade document operations
-- Apply after bootstrap.sql, integrity-hardening.sql and core-operations.sql.
-- Trade documents are commercial obligations only. They do not create cash events or journals.

begin;

create unique index if not exists counterparties_org_type_name_uidx
  on public.counterparties (organization_id, party_type, lower(trim(display_name)));

create or replace function private.guard_trade_document_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $aurel$
begin
  if tg_op = 'INSERT' then
    if new.lifecycle_status <> 'draft' then
      raise exception 'Trade documents must be created as drafts.';
    end if;
    return new;
  end if;

  if old.lifecycle_status = 'draft' and new.lifecycle_status = 'draft' then
    return new;
  end if;

  if old.lifecycle_status = 'draft' and new.lifecycle_status = 'approved' then
    if (to_jsonb(new) - 'lifecycle_status' - 'updated_at')
       is distinct from (to_jsonb(old) - 'lifecycle_status' - 'updated_at') then
      raise exception 'Approving a trade document cannot change its source values.';
    end if;
    return new;
  end if;

  if old.lifecycle_status = 'approved' and new.lifecycle_status = 'invoiced' then
    if (to_jsonb(new) - 'lifecycle_status' - 'updated_at')
       is distinct from (to_jsonb(old) - 'lifecycle_status' - 'updated_at') then
      raise exception 'Issuing a trade document cannot change its approved source values.';
    end if;
    return new;
  end if;

  raise exception 'Invalid or unsupported trade-document transition: % -> %.', old.lifecycle_status, new.lifecycle_status;
end;
$aurel$;

create or replace function private.guard_trade_document_line_draft()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $aurel$
declare
  parent_status text;
  parent_id uuid;
  parent_org uuid;
begin
  if tg_op = 'UPDATE' and (new.trade_document_id is distinct from old.trade_document_id
     or new.organization_id is distinct from old.organization_id) then
    raise exception 'Trade document lines cannot be moved between documents or organisations.';
  end if;

  if tg_op = 'DELETE' then
    parent_id := old.trade_document_id;
    parent_org := old.organization_id;
  else
    parent_id := new.trade_document_id;
    parent_org := new.organization_id;
  end if;

  select lifecycle_status into parent_status
  from public.trade_documents
  where id = parent_id and organization_id = parent_org
  for update;

  if parent_status is distinct from 'draft' then
    raise exception 'Trade document lines can only be changed while the parent document is a draft.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$aurel$;

drop trigger if exists trade_documents_lifecycle_guard on public.trade_documents;
create trigger trade_documents_lifecycle_guard
before insert or update on public.trade_documents
for each row execute function private.guard_trade_document_lifecycle();

drop trigger if exists trade_document_lines_draft_only on public.trade_document_lines;
create trigger trade_document_lines_draft_only
before insert or update or delete on public.trade_document_lines
for each row execute function private.guard_trade_document_line_draft();

revoke all on function private.guard_trade_document_lifecycle() from public, anon, authenticated;
revoke all on function private.guard_trade_document_line_draft() from public, anon, authenticated;

create or replace function public.create_trade_document(
  p_organization_id uuid,
  p_client_id uuid,
  p_document_kind text,
  p_document_number text,
  p_document_date date,
  p_due_date date,
  p_counterparty_name text,
  p_counterparty_gstin text,
  p_counterparty_state text,
  p_description text,
  p_hsn_sac text,
  p_quantity numeric,
  p_unit_rate_minor bigint,
  p_gst_rate numeric,
  p_tax_mode text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $aurel$
declare
  party_type_value text;
  counterparty_id_value uuid;
  taxable_numeric numeric;
  taxable_value bigint;
  tax_value bigint;
  cgst_value bigint := 0;
  sgst_value bigint := 0;
  igst_value bigint := 0;
  total_value bigint;
  document_id_value uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if not private.has_org_role(p_organization_id, array['owner','admin','manager','preparer']) then
    raise exception 'Your organisation role cannot create trade documents.';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id and c.organization_id = p_organization_id) then
    raise exception 'The client does not belong to this organisation.';
  end if;

  if p_document_kind not in ('sales_invoice','purchase_bill','credit_note','debit_note') then
    raise exception 'Unsupported trade document kind.';
  end if;
  if length(trim(coalesce(p_document_number,''))) not between 1 and 80 then
    raise exception 'Document number is required and must not exceed 80 characters.';
  end if;
  if p_document_date is null or (p_due_date is not null and p_due_date < p_document_date) then
    raise exception 'Document date is required and due date cannot be earlier than document date.';
  end if;
  if length(trim(coalesce(p_counterparty_name,''))) not between 2 and 200 then
    raise exception 'Counterparty name must contain 2 to 200 characters.';
  end if;
  if length(trim(coalesce(p_description,''))) not between 2 and 300 then
    raise exception 'A line description between 2 and 300 characters is required.';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 100000000 then
    raise exception 'Quantity must be positive and within supported limits.';
  end if;
  if p_unit_rate_minor is null or p_unit_rate_minor < 0 or p_unit_rate_minor > 9000000000000000 then
    raise exception 'Unit rate must be a non-negative integer paise amount.';
  end if;
  if p_gst_rate is null or p_gst_rate < 0 or p_gst_rate > 100 then
    raise exception 'GST rate must be between 0 and 100 percent.';
  end if;
  if p_tax_mode not in ('intra','inter') then
    raise exception 'Tax mode must be intra-state or inter-state.';
  end if;

  taxable_numeric := round(p_quantity * p_unit_rate_minor);
  if taxable_numeric < 0 or taxable_numeric > 9000000000000000 then
    raise exception 'Taxable value is outside supported limits.';
  end if;
  taxable_value := taxable_numeric::bigint;
  tax_value := round(taxable_value * p_gst_rate / 100)::bigint;
  if tax_value > 9000000000000000 then
    raise exception 'GST amount is outside supported limits.';
  end if;
  if p_tax_mode = 'intra' then
    cgst_value := floor(tax_value::numeric / 2)::bigint;
    sgst_value := tax_value - cgst_value;
  else
    igst_value := tax_value;
  end if;
  total_value := taxable_value + tax_value;

  party_type_value := case when p_document_kind in ('sales_invoice','credit_note') then 'customer' else 'supplier' end;
  select cp.id into counterparty_id_value
  from public.counterparties cp
  where cp.organization_id = p_organization_id
    and cp.party_type = party_type_value
    and lower(trim(cp.display_name)) = lower(trim(p_counterparty_name))
  order by cp.created_at
  limit 1;

  if counterparty_id_value is null then
    insert into public.counterparties (organization_id, display_name, legal_name, party_type, gstin, state)
    values (p_organization_id, trim(p_counterparty_name), trim(p_counterparty_name), party_type_value,
      nullif(upper(trim(coalesce(p_counterparty_gstin,''))),''), nullif(trim(coalesce(p_counterparty_state,'')),''))
    returning id into counterparty_id_value;
  else
    update public.counterparties
    set gstin = coalesce(nullif(upper(trim(coalesce(p_counterparty_gstin,''))),''), gstin),
        state = coalesce(nullif(trim(coalesce(p_counterparty_state,'')),''), state),
        updated_at = now()
    where id = counterparty_id_value and organization_id = p_organization_id;
  end if;

  insert into public.trade_documents (
    organization_id, client_id, counterparty_id, document_kind, document_number,
    document_date, due_date, place_of_supply, taxable_minor, cgst_minor, sgst_minor,
    igst_minor, total_minor, currency_code, lifecycle_status, created_by
  ) values (
    p_organization_id, p_client_id, counterparty_id_value, p_document_kind, trim(p_document_number),
    p_document_date, p_due_date, nullif(trim(coalesce(p_counterparty_state,'')),''), taxable_value,
    cgst_value, sgst_value, igst_value, total_value, 'INR', 'draft', (select auth.uid())
  ) returning id into document_id_value;

  insert into public.trade_document_lines (
    organization_id, trade_document_id, line_number, description, hsn_sac, quantity,
    unit_rate_minor, taxable_minor, gst_rate, tax_minor
  ) values (
    p_organization_id, document_id_value, 1, trim(p_description),
    nullif(trim(coalesce(p_hsn_sac,'')),''), p_quantity, p_unit_rate_minor, taxable_value, p_gst_rate, tax_value
  );

  return document_id_value;
end;
$aurel$;

create or replace function public.approve_trade_document(
  p_organization_id uuid,
  p_trade_document_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $aurel$
declare
  changed_id uuid;
begin
  if not private.has_org_role(p_organization_id, array['owner','admin','manager','reviewer']) then
    raise exception 'Your organisation role cannot approve trade documents.';
  end if;

  update public.trade_documents
  set lifecycle_status = 'approved', updated_at = now()
  where id = p_trade_document_id and organization_id = p_organization_id
    and lifecycle_status = 'draft' and created_by is distinct from (select auth.uid())
  returning id into changed_id;

  if changed_id is null then
    raise exception 'Trade document was not found, is not a draft, or was created by the approving user.';
  end if;
  return changed_id;
end;
$aurel$;

create or replace function public.issue_trade_document(
  p_organization_id uuid,
  p_trade_document_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $aurel$
declare
  changed_id uuid;
begin
  if not private.has_org_role(p_organization_id, array['owner','admin','manager']) then
    raise exception 'Only an organisation owner, admin or manager can issue a trade document.';
  end if;

  update public.trade_documents
  set lifecycle_status = 'invoiced', updated_at = now()
  where id = p_trade_document_id and organization_id = p_organization_id
    and lifecycle_status = 'approved'
  returning id into changed_id;

  if changed_id is null then
    raise exception 'Trade document was not found or is not approved.';
  end if;
  return changed_id;
end;
$aurel$;

revoke all on function public.create_trade_document(uuid,uuid,text,text,date,date,text,text,text,text,text,numeric,bigint,numeric,text) from public, anon;
revoke all on function public.approve_trade_document(uuid,uuid) from public, anon;
revoke all on function public.issue_trade_document(uuid,uuid) from public, anon;
grant execute on function public.create_trade_document(uuid,uuid,text,text,date,date,text,text,text,text,text,numeric,bigint,numeric,text) to authenticated;
grant execute on function public.approve_trade_document(uuid,uuid) to authenticated;
grant execute on function public.issue_trade_document(uuid,uuid) to authenticated;

commit;