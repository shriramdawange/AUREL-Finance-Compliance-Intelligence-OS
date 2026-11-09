-- Run after bootstrap.sql, integrity-hardening.sql and core-operations.sql.
-- This is a non-destructive deployment smoke check. It creates no sample data.

do $$
declare
  required_functions text[] := array[
    'ensure_default_chart_of_accounts(uuid,uuid)',
    'create_journal_draft(uuid,uuid,date,text,jsonb)',
    'submit_journal_for_review(uuid,uuid)',
    'approve_journal(uuid,uuid)',
    'post_approved_journal(uuid,uuid)',
    'get_trial_balance(uuid,uuid,date)',
    'get_profit_and_loss(uuid,uuid,date,date)',
    'get_balance_sheet(uuid,uuid,date)',
    'get_general_ledger(uuid,uuid,date,date)',
    'import_bank_statement_rows(uuid,uuid,uuid,uuid,jsonb)',
    'create_trade_document(uuid,uuid,text,text,date,date,text,text,text,text,text,numeric,bigint,numeric,text)',
    'approve_trade_document(uuid,uuid)',
    'issue_trade_document(uuid,uuid)'
  ];
  function_signature text;
begin
  foreach function_signature in array required_functions loop
    if to_regprocedure('public.' || function_signature) is null then
      raise exception 'Missing required AUREL RPC: public.%', function_signature;
    end if;
  end loop;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'journal_entries' and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.journal_entries.';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'journal_lines' and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.journal_lines.';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'journal_entries'
      and t.tgname = 'journal_entries_lifecycle_guard' and not t.tgisinternal
  ) then
    raise exception 'Journal lifecycle guard trigger is not installed.';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'journal_lines'
      and t.tgname = 'journal_lines_draft_only' and not t.tgisinternal
  ) then
    raise exception 'Journal line mutation guard trigger is not installed.';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'ensure_default_chart_of_accounts','create_journal_draft',
        'submit_journal_for_review','approve_journal','post_approved_journal',
        'get_trial_balance','get_profit_and_loss','get_balance_sheet','get_general_ledger','import_bank_statement_rows','create_trade_document','approve_trade_document','issue_trade_document'
      )
      and p.prosecdef
  ) then
    raise exception 'An AUREL public RPC unexpectedly runs with SECURITY DEFINER.';
  end if;

  raise notice 'AUREL core operations smoke check passed.';
end;
$$;

select
  p.proname as function_name,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'ensure_default_chart_of_accounts','create_journal_draft',
    'submit_journal_for_review','approve_journal','post_approved_journal',
    'get_trial_balance','get_profit_and_loss','get_balance_sheet','get_general_ledger','import_bank_statement_rows','create_trade_document','approve_trade_document','issue_trade_document'
  )
order by p.proname;
