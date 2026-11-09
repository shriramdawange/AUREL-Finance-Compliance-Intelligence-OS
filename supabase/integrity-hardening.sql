-- AUREL integrity hardening. Included by bootstrap.sql in the baseline release.

-- Provider payloads are private server-side intake records only.
revoke all on table public.provider_webhook_events from public, anon, authenticated;
grant all on table public.provider_webhook_events to service_role;

-- Prevent a journal from being marked posted unless it is a balanced double-entry journal.
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
  if new.lifecycle_status = 'posted'
     and (tg_op = 'INSERT' or old.lifecycle_status is distinct from 'posted') then
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

-- A journal line may only be added, edited or removed while its parent entry is a draft.
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
begin
  if tg_op = 'DELETE' then
    parent_id := old.journal_entry_id;
    parent_org := old.organization_id;
  else
    parent_id := new.journal_entry_id;
    parent_org := new.organization_id;
  end if;

  select lifecycle_status into parent_status
  from public.journal_entries
  where id = parent_id and organization_id = parent_org;

  if parent_status is distinct from 'draft' then
    raise exception 'Journal lines can only be changed while the journal is a draft.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists journal_lines_draft_only on public.journal_lines;
create trigger journal_lines_draft_only
before insert or update or delete on public.journal_lines
for each row execute function private.guard_journal_line_mutation();

revoke all on function private.assert_journal_balanced() from public, anon, authenticated;
revoke all on function private.guard_journal_line_mutation() from public, anon, authenticated;

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

-- A PayPal capture may create at most one canonical cash event for a given resource ID.
create unique index if not exists financial_events_provider_resource_idx
  on public.financial_events (organization_id, source_system, provider_event_id)
  where provider_event_id is not null;
