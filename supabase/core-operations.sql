-- AUREL Core Operations
-- Apply after bootstrap.sql and integrity-hardening.sql on a dedicated AUREL project.
-- These invoker-rights RPCs make the first accounting workflows usable without bypassing RLS.

begin;

-- One statement import can contain each external row identifier only once.
create unique index if not exists bank_statement_import_line_uidx
  on public.bank_statement_lines (organization_id, statement_import_id, external_line_id)
  where external_line_id is not null;

create or replace function public.ensure_default_chart_of_accounts(
  p_organization_id uuid,
  p_client_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if not private.has_org_role(p_organization_id, array['owner','admin','manager']) then
    raise exception 'Only organisation owners, admins or managers can initialise a chart of accounts.';
  end if;

  if not exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.organization_id = p_organization_id
  ) then
    raise exception 'The client does not belong to this organisation.';
  end if;

  insert into public.accounts (
    organization_id, client_id, account_code, account_name,
    account_group, normal_balance, is_system, is_active
  )
  values
    (p_organization_id, p_client_id, '1000', 'Cash on Hand', 'asset', 'debit', true, true),
    (p_organization_id, p_client_id, '1010', 'Bank - Operating', 'asset', 'debit', true, true),
    (p_organization_id, p_client_id, '1100', 'Accounts Receivable', 'asset', 'debit', true, true),
    (p_organization_id, p_client_id, '1200', 'Input GST - CGST', 'asset', 'debit', true, true),
    (p_organization_id, p_client_id, '1210', 'Input GST - SGST', 'asset', 'debit', true, true),
    (p_organization_id, p_client_id, '1220', 'Input GST - IGST', 'asset', 'debit', true, true),
    (p_organization_id, p_client_id, '1300', 'Inventory', 'asset', 'debit', true, true),
    (p_organization_id, p_client_id, '2000', 'Accounts Payable', 'liability', 'credit', true, true),
    (p_organization_id, p_client_id, '2100', 'Output GST - CGST', 'liability', 'credit', true, true),
    (p_organization_id, p_client_id, '2110', 'Output GST - SGST', 'liability', 'credit', true, true),
    (p_organization_id, p_client_id, '2120', 'Output GST - IGST', 'liability', 'credit', true, true),
    (p_organization_id, p_client_id, '2200', 'TDS Payable', 'liability', 'credit', true, true),
    (p_organization_id, p_client_id, '3000', 'Owner Capital', 'equity', 'credit', true, true),
    (p_organization_id, p_client_id, '3100', 'Retained Earnings', 'equity', 'credit', true, true),
    (p_organization_id, p_client_id, '4000', 'Sales Revenue', 'income', 'credit', true, true),
    (p_organization_id, p_client_id, '4100', 'Other Operating Income', 'income', 'credit', true, true),
    (p_organization_id, p_client_id, '5000', 'Cost of Goods Sold', 'expense', 'debit', true, true),
    (p_organization_id, p_client_id, '5100', 'Salaries and Wages', 'expense', 'debit', true, true),
    (p_organization_id, p_client_id, '5200', 'Rent Expense', 'expense', 'debit', true, true),
    (p_organization_id, p_client_id, '5300', 'Utilities Expense', 'expense', 'debit', true, true),
    (p_organization_id, p_client_id, '5400', 'Software and Hosting', 'expense', 'debit', true, true),
    (p_organization_id, p_client_id, '5500', 'Payment Processing Fees', 'expense', 'debit', true, true),
    (p_organization_id, p_client_id, '5600', 'Travel and Conveyance', 'expense', 'debit', true, true),
    (p_organization_id, p_client_id, '5700', 'Professional Fees', 'expense', 'debit', true, true),
    (p_organization_id, p_client_id, '5900', 'Other Operating Expenses', 'expense', 'debit', true, true)
  on conflict (organization_id, client_id, account_code) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.create_journal_draft(
  p_organization_id uuid,
  p_client_id uuid,
  p_journal_date date,
  p_narration text,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_journal_id uuid;
  new_journal_number text;
  row_count integer;
  valid_account_count integer;
  debit_total numeric;
  credit_total numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if not private.has_org_role(p_organization_id, array['owner','admin','manager','preparer']) then
    raise exception 'Your organisation role cannot create journal drafts.';
  end if;

  if not exists (
    select 1 from public.clients c
    where c.id = p_client_id and c.organization_id = p_organization_id
  ) then
    raise exception 'The client does not belong to this organisation.';
  end if;

  if p_journal_date is null or length(trim(coalesce(p_narration, ''))) not between 3 and 500 then
    raise exception 'A journal date and narration between 3 and 500 characters are required.';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 2 and 50 then
    raise exception 'A journal must contain between 2 and 50 lines.';
  end if;

  select
    count(*)::integer,
    coalesce(sum(coalesce(x.debit_minor, 0)), 0),
    coalesce(sum(coalesce(x.credit_minor, 0)), 0)
  into row_count, debit_total, credit_total
  from jsonb_to_recordset(p_lines) as x(
    account_id uuid,
    debit_minor bigint,
    credit_minor bigint,
    description text
  );

  if row_count <> jsonb_array_length(p_lines) then
    raise exception 'Every journal line must be a valid object.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_lines) as x(
      account_id uuid,
      debit_minor bigint,
      credit_minor bigint,
      description text
    )
    where x.account_id is null
       or coalesce(x.debit_minor, 0) < 0
       or coalesce(x.credit_minor, 0) < 0
       or not (
         (coalesce(x.debit_minor, 0) > 0 and coalesce(x.credit_minor, 0) = 0)
         or
         (coalesce(x.credit_minor, 0) > 0 and coalesce(x.debit_minor, 0) = 0)
       )
  ) then
    raise exception 'Each journal line must contain one positive debit or credit amount, never both.';
  end if;

  if debit_total <= 0 or debit_total <> credit_total then
    raise exception 'Journal is not balanced: total debits must equal total credits and be greater than zero.';
  end if;

  select count(*)::integer
  into valid_account_count
  from jsonb_to_recordset(p_lines) as x(
    account_id uuid,
    debit_minor bigint,
    credit_minor bigint,
    description text
  )
  join public.accounts a
    on a.id = x.account_id
   and a.organization_id = p_organization_id
   and a.client_id = p_client_id
   and a.is_active;

  if valid_account_count <> row_count then
    raise exception 'Every account must be active and belong to the selected client and organisation.';
  end if;

  new_journal_number := 'AUR-' || to_char(p_journal_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.journal_entries (
    organization_id, client_id, journal_number, journal_date,
    narration, lifecycle_status, created_by
  )
  values (
    p_organization_id, p_client_id, new_journal_number, p_journal_date,
    trim(p_narration), 'draft', (select auth.uid())
  )
  returning id into new_journal_id;

  insert into public.journal_lines (
    organization_id, journal_entry_id, account_id, line_number,
    description, debit_minor, credit_minor
  )
  select
    p_organization_id,
    new_journal_id,
    (item.value ->> 'account_id')::uuid,
    item.ordinality::integer,
    nullif(trim(item.value ->> 'description'), ''),
    coalesce((item.value ->> 'debit_minor')::bigint, 0),
    coalesce((item.value ->> 'credit_minor')::bigint, 0)
  from jsonb_array_elements(p_lines) with ordinality as item(value, ordinality)
  order by item.ordinality;

  return new_journal_id;
end;
$$;

create or replace function public.submit_journal_for_review(
  p_organization_id uuid,
  p_journal_entry_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_id uuid;
begin
  if not private.has_org_role(p_organization_id, array['owner','admin','manager','preparer']) then
    raise exception 'Your organisation role cannot submit journal drafts.';
  end if;

  update public.journal_entries
  set lifecycle_status = 'pending_review'
  where id = p_journal_entry_id
    and organization_id = p_organization_id
    and lifecycle_status = 'draft'
  returning id into changed_id;

  if changed_id is null then
    raise exception 'Journal not found or is not in draft status.';
  end if;

  return changed_id;
end;
$$;

create or replace function public.approve_journal(
  p_organization_id uuid,
  p_journal_entry_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_id uuid;
begin
  if not private.has_org_role(p_organization_id, array['owner','admin','manager','reviewer']) then
    raise exception 'Your organisation role cannot approve journal entries.';
  end if;

  update public.journal_entries
  set lifecycle_status = 'approved',
      approved_by = (select auth.uid())
  where id = p_journal_entry_id
    and organization_id = p_organization_id
    and lifecycle_status = 'pending_review'
  returning id into changed_id;

  if changed_id is null then
    raise exception 'Journal not found or is not awaiting review.';
  end if;

  return changed_id;
end;
$$;

create or replace function public.post_approved_journal(
  p_organization_id uuid,
  p_journal_entry_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed_id uuid;
begin
  if not private.has_org_role(p_organization_id, array['owner','admin','manager']) then
    raise exception 'Only organisation owners, admins or managers can post approved journals.';
  end if;

  update public.journal_entries
  set lifecycle_status = 'posted',
      posted_at = now()
  where id = p_journal_entry_id
    and organization_id = p_organization_id
    and lifecycle_status = 'approved'
  returning id into changed_id;

  if changed_id is null then
    raise exception 'Journal not found or is not approved.';
  end if;

  return changed_id;
end;
$$;

create or replace function public.get_trial_balance(
  p_organization_id uuid,
  p_client_id uuid,
  p_as_of_date date
)
returns table (
  account_id uuid,
  account_code text,
  account_name text,
  account_group text,
  total_debits_minor bigint,
  total_credits_minor bigint,
  closing_debit_minor bigint,
  closing_credit_minor bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_org_member(p_organization_id) then
    raise exception 'You are not a member of this organisation.';
  end if;
  if p_as_of_date is null then
    raise exception 'An as-of date is required.';
  end if;

  return query
  select
    a.id,
    a.account_code,
    a.account_name,
    a.account_group,
    coalesce(sum(l.debit_minor), 0)::bigint,
    coalesce(sum(l.credit_minor), 0)::bigint,
    greatest(coalesce(sum(l.debit_minor), 0) - coalesce(sum(l.credit_minor), 0), 0)::bigint,
    greatest(coalesce(sum(l.credit_minor), 0) - coalesce(sum(l.debit_minor), 0), 0)::bigint
  from public.accounts a
  left join public.journal_lines l
    on l.account_id = a.id
   and l.organization_id = a.organization_id
   and exists (
     select 1
     from public.journal_entries j
     where j.id = l.journal_entry_id
       and j.organization_id = l.organization_id
       and j.lifecycle_status = 'posted'
       and j.journal_date <= p_as_of_date
   )
  where a.organization_id = p_organization_id
    and a.client_id = p_client_id
  group by a.id, a.account_code, a.account_name, a.account_group
  order by a.account_code;
end;
$$;

create or replace function public.get_profit_and_loss(
  p_organization_id uuid,
  p_client_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  account_id uuid,
  account_code text,
  account_name text,
  account_group text,
  balance_minor bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_org_member(p_organization_id) then
    raise exception 'You are not a member of this organisation.';
  end if;
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise exception 'A valid reporting period is required.';
  end if;

  return query
  select
    a.id,
    a.account_code,
    a.account_name,
    a.account_group,
    case
      when a.account_group = 'income'
        then (coalesce(sum(l.credit_minor), 0) - coalesce(sum(l.debit_minor), 0))::bigint
      else (coalesce(sum(l.debit_minor), 0) - coalesce(sum(l.credit_minor), 0))::bigint
    end
  from public.accounts a
  left join public.journal_lines l
    on l.account_id = a.id
   and l.organization_id = a.organization_id
   and exists (
     select 1
     from public.journal_entries j
     where j.id = l.journal_entry_id
       and j.organization_id = l.organization_id
       and j.lifecycle_status = 'posted'
       and j.journal_date between p_period_start and p_period_end
   )
  where a.organization_id = p_organization_id
    and a.client_id = p_client_id
    and a.account_group in ('income','expense')
  group by a.id, a.account_code, a.account_name, a.account_group
  having coalesce(sum(l.debit_minor), 0) <> coalesce(sum(l.credit_minor), 0)
  order by a.account_code;
end;
$$;

create or replace function public.get_balance_sheet(
  p_organization_id uuid,
  p_client_id uuid,
  p_as_of_date date
)
returns table (
  account_id uuid,
  account_code text,
  account_name text,
  account_group text,
  balance_minor bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_org_member(p_organization_id) then
    raise exception 'You are not a member of this organisation.';
  end if;
  if p_as_of_date is null then
    raise exception 'An as-of date is required.';
  end if;

  return query
  select
    a.id,
    a.account_code,
    a.account_name,
    a.account_group,
    case
      when a.account_group = 'asset'
        then (coalesce(sum(l.debit_minor), 0) - coalesce(sum(l.credit_minor), 0))::bigint
      else (coalesce(sum(l.credit_minor), 0) - coalesce(sum(l.debit_minor), 0))::bigint
    end
  from public.accounts a
  left join public.journal_lines l
    on l.account_id = a.id
   and l.organization_id = a.organization_id
   and exists (
     select 1
     from public.journal_entries j
     where j.id = l.journal_entry_id
       and j.organization_id = l.organization_id
       and j.lifecycle_status = 'posted'
       and j.journal_date <= p_as_of_date
   )
  where a.organization_id = p_organization_id
    and a.client_id = p_client_id
    and a.account_group in ('asset','liability','equity')
  group by a.id, a.account_code, a.account_name, a.account_group
  having coalesce(sum(l.debit_minor), 0) <> coalesce(sum(l.credit_minor), 0)
  order by a.account_code;
end;
$$;


create or replace function public.import_bank_statement_rows(
  p_organization_id uuid,
  p_client_id uuid,
  p_financial_account_id uuid,
  p_statement_import_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $aurel$
declare
  row_data jsonb;
  external_line_id text;
  date_text text;
  line_date date;
  line_narration text;
  debit_text text;
  credit_text text;
  debit_value bigint;
  credit_value bigint;
  source_row_value jsonb;
  inserted_line_count integer := 0;
  inserted_event_count integer := 0;
  duplicate_count integer := 0;
  inserted_this_row integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if not private.has_org_role(p_organization_id, array['owner','admin','manager','preparer']) then
    raise exception 'Your organisation role cannot import bank statement rows.';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id and c.organization_id = p_organization_id) then
    raise exception 'The client does not belong to this organisation.';
  end if;

  if p_statement_import_id is null then
    raise exception 'A stable statement import identifier is required.';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import between 1 and 5000 bank statement rows per request.';
  end if;

  if p_financial_account_id is not null and not exists (
    select 1 from public.financial_accounts fa
    where fa.id = p_financial_account_id
      and fa.organization_id = p_organization_id
      and (fa.client_id = p_client_id or fa.client_id is null)
      and fa.status = 'active'
  ) then
    raise exception 'The selected financial account is not active or does not belong to this client and organisation.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) as x(value)
    group by x.value ->> 'external_line_id'
    having count(*) > 1
  ) then
    raise exception 'The import contains duplicate external_line_id values.';
  end if;

  for row_data in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(row_data) <> 'object' then
      raise exception 'Every import row must be a JSON object.';
    end if;

    external_line_id := nullif(trim(row_data ->> 'external_line_id'), '');
    date_text := trim(coalesce(row_data ->> 'transaction_date', ''));
    line_narration := trim(coalesce(row_data ->> 'narration', ''));
    debit_text := trim(coalesce(row_data ->> 'debit_minor', '0'));
    credit_text := trim(coalesce(row_data ->> 'credit_minor', '0'));
    source_row_value := coalesce(row_data -> 'source_row', '{}'::jsonb);

    if external_line_id is null or length(external_line_id) > 160 then
      raise exception 'Every row must contain an external_line_id up to 160 characters.';
    end if;

    if length(date_text) <> 10 or date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
      raise exception 'Every row must contain a valid ISO transaction_date (YYYY-MM-DD).';
    end if;
    line_date := date_text::date;

    if line_narration = '' or length(line_narration) > 1000 then
      raise exception 'Every row must contain a narration between 1 and 1000 characters.';
    end if;

    if length(debit_text) < 1 or length(debit_text) > 18 or debit_text ~ '[^0-9]'
       or length(credit_text) < 1 or length(credit_text) > 18 or credit_text ~ '[^0-9]' then
      raise exception 'Debit and credit amounts must be non-negative integer paise.';
    end if;
    debit_value := debit_text::bigint;
    credit_value := credit_text::bigint;

    if not ((debit_value > 0 and credit_value = 0) or (credit_value > 0 and debit_value = 0)) then
      raise exception 'Each row must have either a positive debit or a positive credit, never both.';
    end if;

    if jsonb_typeof(source_row_value) <> 'object' then
      raise exception 'source_row must be a JSON object.';
    end if;

    insert into public.bank_statement_lines (
      organization_id, client_id, financial_account_id, statement_import_id,
      external_line_id, transaction_date, narration, debit_minor, credit_minor, currency_code, source_row
    ) values (
      p_organization_id, p_client_id, p_financial_account_id, p_statement_import_id,
      external_line_id, line_date, line_narration, debit_value, credit_value, 'INR', source_row_value
    )
    on conflict (organization_id, statement_import_id, external_line_id)
      where external_line_id is not null
    do nothing;

    get diagnostics inserted_this_row = row_count;
    if inserted_this_row = 1 then
      inserted_line_count := inserted_line_count + 1;

      insert into public.financial_events (
        organization_id, client_id, financial_account_id, source_system, source_external_id, idempotency_key,
        event_type, cash_direction, event_category, gross_minor, fee_minor, net_minor, currency_code,
        lifecycle_status, description, occurred_at, created_by
      ) values (
        p_organization_id, p_client_id, p_financial_account_id, 'bank_csv',
        p_statement_import_id::text || ':' || external_line_id,
        'bankcsv:' || p_statement_import_id::text || ':' || external_line_id,
        case when debit_value > 0 then 'bank_debit' else 'bank_credit' end,
        case when debit_value > 0 then 'outflow' else 'inflow' end,
        'other', greatest(debit_value, credit_value), 0, greatest(debit_value, credit_value), 'INR',
        'committed', line_narration, line_date::timestamp at time zone 'Asia/Kolkata', (select auth.uid())
      ) on conflict (organization_id, source_system, idempotency_key) do nothing;

      get diagnostics inserted_this_row = row_count;
      if inserted_this_row = 1 then inserted_event_count := inserted_event_count + 1; end if;
    else
      duplicate_count := duplicate_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'statement_lines_inserted', inserted_line_count,
    'financial_events_created', inserted_event_count,
    'duplicate_lines_skipped', duplicate_count,
    'statement_import_id', p_statement_import_id
  );
end;
$aurel$;

revoke all on function public.ensure_default_chart_of_accounts(uuid, uuid) from public, anon;
revoke all on function public.create_journal_draft(uuid, uuid, date, text, jsonb) from public, anon;
revoke all on function public.submit_journal_for_review(uuid, uuid) from public, anon;
revoke all on function public.approve_journal(uuid, uuid) from public, anon;
revoke all on function public.post_approved_journal(uuid, uuid) from public, anon;
revoke all on function public.get_trial_balance(uuid, uuid, date) from public, anon;
revoke all on function public.get_profit_and_loss(uuid, uuid, date, date) from public, anon;
revoke all on function public.get_balance_sheet(uuid, uuid, date) from public, anon;
revoke all on function public.import_bank_statement_rows(uuid, uuid, uuid, uuid, jsonb) from public, anon;

grant execute on function public.ensure_default_chart_of_accounts(uuid, uuid) to authenticated;
grant execute on function public.create_journal_draft(uuid, uuid, date, text, jsonb) to authenticated;
grant execute on function public.submit_journal_for_review(uuid, uuid) to authenticated;
grant execute on function public.approve_journal(uuid, uuid) to authenticated;
grant execute on function public.post_approved_journal(uuid, uuid) to authenticated;
grant execute on function public.get_trial_balance(uuid, uuid, date) to authenticated;
grant execute on function public.get_profit_and_loss(uuid, uuid, date, date) to authenticated;
grant execute on function public.get_balance_sheet(uuid, uuid, date) to authenticated;
grant execute on function public.import_bank_statement_rows(uuid, uuid, uuid, uuid, jsonb) to authenticated;

commit;
