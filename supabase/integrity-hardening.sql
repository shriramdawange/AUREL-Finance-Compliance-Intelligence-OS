-- AUREL integrity hardening. Run after bootstrap.sql on a new AUREL project.

-- Provider payloads are private server-side intake records only.
revoke all on table public.provider_webhook_events from public, anon, authenticated;
grant all on table public.provider_webhook_events to service_role;

-- Prevent posting a journal unless it is a balanced double-entry journal.
create or replace function private.assert_journal_balanced()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  line_count bigint;
  debit_total bigint;
  credit_total bigint;
begin
  if new.lifecycle_status = 'posted' then
    if tg_op = 'UPDATE' and old.lifecycle_status = 'posted' then
      return new;
    end if;

    select count(*), coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0)
      into line_count, debit_total, credit_total
    from public.journal_lines
    where organization_id = new.organization_id
      and journal_entry_id = new.id;

    if line_count < 2 or debit_total <= 0 or debit_total <> credit_total then
      raise exception 'Journal cannot be posted: at least two lines are required and total debits must equal total credits.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists journal_entries_balance_before_post on public.journal_entries;
create trigger journal_entries_balance_before_post
before insert or update of lifecycle_status on public.journal_entries
for each row execute function private.assert_journal_balanced();
 
-- Enforce lifecycle order at the database boundary; UI/RPC checks are not enough.
create or replace function private.guard_journal_entry_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $
begin
  if tg_op = 'INSERT' then
    if new.lifecycle_status <> 'draft' then
      raise exception 'Journal entries must be created as drafts.';
    end if;
    return new;
  end if;

  if old.lifecycle_status = 'posted' then
    raise exception 'Posted journals are immutable.';
  end if;

  if new.lifecycle_status = old.lifecycle_status then
    if old.lifecycle_status <> 'draft' then
      raise exception 'Only draft journals may be edited.';
    end if;
    return new;
  end if;

  if old.lifecycle_status = 'draft' and new.lifecycle_status = 'pending_review' then
    if (to_jsonb(new) - 'lifecycle_status' - 'updated_at')
       is distinct from (to_jsonb(old) - 'lifecycle_status' - 'updated_at') then
      raise exception 'Submitting a journal cannot change its accounting content.';
    end if;
    return new;
  end if;

  if old.lifecycle_status = 'pending_review' and new.lifecycle_status = 'approved' then
    if (to_jsonb(new) - 'lifecycle_status' - 'approved_by' - 'updated_at')
       is distinct from (to_jsonb(old) - 'lifecycle_status' - 'approved_by' - 'updated_at') then
      raise exception 'Approving a journal cannot change its accounting content.';
    end if;
    return new;
  end if;

  if old.lifecycle_status = 'approved' and new.lifecycle_status = 'posted' then
    if (to_jsonb(new) - 'lifecycle_status' - 'posted_at' - 'updated_at')
       is distinct from (to_jsonb(old) - 'lifecycle_status' - 'posted_at' - 'updated_at') then
      raise exception 'Posting a journal cannot change its accounting content.';
    end if;
    return new;
  end if;

  raise exception 'Invalid journal lifecycle transition: % -> %.', old.lifecycle_status, new.lifecycle_status;
end;
$;

drop trigger if exists journal_entries_lifecycle_guard on public.journal_entries;
create trigger journal_entries_lifecycle_guard
before insert or update on public.journal_entries
for each row execute function private.guard_journal_entry_lifecycle();

revoke all on function private.guard_journal_entry_lifecycle() from public, anon, authenticated;


-- A journal line may only be added, edited or removed while its parent entry is a draft.
-- FOR UPDATE serializes line changes against the parent journal being posted.
create or replace function private.guard_journal_line_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_status text;
  parent_org uuid;
  parent_id uuid;
  parent_client uuid;
begin
  if tg_op = 'UPDATE'
     and (new.organization_id is distinct from old.organization_id
       or new.journal_entry_id is distinct from old.journal_entry_id) then
    raise exception 'Journal lines cannot be moved between journals or organisations.';
  end if;

  if tg_op = 'DELETE' then
    parent_id := old.journal_entry_id;
    parent_org := old.organization_id;
  else
    parent_id := new.journal_entry_id;
    parent_org := new.organization_id;
  end if;

  select lifecycle_status, client_id
    into parent_status, parent_client
  from public.journal_entries
  where id = parent_id and organization_id = parent_org
  for update;

  if parent_status is distinct from 'draft' then
    raise exception 'Journal lines can only be changed while the journal is a draft.';
  end if;

  if tg_op <> 'DELETE' and not exists (
    select 1 from public.accounts a
    where a.id = new.account_id
      and a.organization_id = parent_org
      and a.client_id = parent_client
      and a.is_active
  ) then
    raise exception 'Journal lines must use active accounts belonging to the same client and organisation.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$;

drop trigger if exists journal_lines_draft_only on public.journal_lines;
create trigger journal_lines_draft_only
before insert or update or delete on public.journal_lines
for each row execute function private.guard_journal_line_mutation();

revoke all on function private.assert_journal_balanced() from public, anon, authenticated;
revoke all on function private.guard_journal_line_mutation() from public, anon, authenticated;

-- Bootstrap entries must start as drafts; a privileged server-side workflow posts them.
drop policy if exists journal_entries_insert_operator on public.journal_entries;
create policy journal_entries_insert_operator on public.journal_entries
for insert to authenticated
with check (
  lifecycle_status = 'draft'
  and private.has_org_role(organization_id, array['owner','admin','manager','preparer'])
);

drop policy if exists journal_entries_update_draft on public.journal_entries;
create policy journal_entries_update_draft on public.journal_entries
for update to authenticated
using (
  (lifecycle_status = 'draft'
    and private.has_org_role(organization_id, array['owner','admin','manager','preparer']))
  or (lifecycle_status = 'pending_review'
    and private.has_org_role(organization_id, array['owner','admin','manager','reviewer']))
  or (lifecycle_status = 'approved'
    and private.has_org_role(organization_id, array['owner','admin','manager']))
)
with check (
  (lifecycle_status in ('draft','pending_review')
    and private.has_org_role(organization_id, array['owner','admin','manager','preparer']))
  or (lifecycle_status = 'approved'
    and private.has_org_role(organization_id, array['owner','admin','manager','reviewer']))
  or (lifecycle_status = 'posted'
    and private.has_org_role(organization_id, array['owner','admin','manager']))
);

grant delete on public.journal_lines to authenticated;
drop policy if exists journal_lines_delete_draft on public.journal_lines;
create policy journal_lines_delete_draft on public.journal_lines
for delete to authenticated using (
  private.has_org_role(organization_id, array['owner','admin','manager','preparer'])
  and exists (
    select 1 from public.journal_entries j
    where j.id = journal_entry_id
      and j.organization_id = organization_id
      and j.lifecycle_status = 'draft'
  )
);

drop policy if exists journal_lines_update_draft on public.journal_lines;
create policy journal_lines_update_draft on public.journal_lines
for update to authenticated using (
  private.has_org_role(organization_id, array['owner','admin','manager','preparer'])
  and exists (
    select 1 from public.journal_entries j
    where j.id = journal_entry_id and j.organization_id = organization_id and j.lifecycle_status = 'draft'
  )
) with check (
  private.has_org_role(organization_id, array['owner','admin','manager','preparer'])
  and exists (
    select 1 from public.journal_entries j
    where j.id = journal_entry_id and j.organization_id = organization_id and j.lifecycle_status = 'draft'
  )
);

-- A PayPal capture/resource can create at most one canonical cash event in an organisation.
create unique index if not exists financial_events_provider_resource_idx
  on public.financial_events (organization_id, source_system, provider_event_id)
  where provider_event_id is not null;
