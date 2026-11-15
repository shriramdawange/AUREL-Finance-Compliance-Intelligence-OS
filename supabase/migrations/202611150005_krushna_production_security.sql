-- Production hardening: constrain cross-tenant party references, lock down definer RPCs, grant least-privilege Data API access.
create unique index if not exists krushna_parties_business_id_id_uidx on public.krushna_parties(business_id,id);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='krushna_invoices_customer_same_business_fk') then
  alter table public.krushna_invoices add constraint krushna_invoices_customer_same_business_fk foreign key(business_id,customer_id) references public.krushna_parties(business_id,id);
 end if;
 if not exists(select 1 from pg_constraint where conname='krushna_purchases_supplier_same_business_fk') then
  alter table public.krushna_purchases add constraint krushna_purchases_supplier_same_business_fk foreign key(business_id,supplier_id) references public.krushna_parties(business_id,id);
 end if;
end $$;

create or replace function public.krushna_is_member(bid uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and exists(select 1 from public.krushna_memberships m where m.business_id=bid and m.user_id=auth.uid());
$$;
create or replace function public.krushna_has_role(bid uuid, roles text[])
returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and exists(select 1 from public.krushna_memberships m where m.business_id=bid and m.user_id=auth.uid() and m.role=any(roles));
$$;

-- SECURITY DEFINER functions in public are not callable by anon/PUBLIC.
revoke all on function public.krushna_is_member(uuid) from public, anon;
revoke all on function public.krushna_has_role(uuid,text[]) from public, anon;
revoke all on function public.krushna_create_business(text,text,text,text,text,text) from public, anon;
revoke all on function public.krushna_next_invoice_number(uuid,text) from public, anon;
revoke all on function public.krushna_post_invoice(uuid,text,date,uuid,text,text,text,text,boolean,jsonb,numeric) from public, anon;
revoke all on function public.krushna_post_purchase(uuid,uuid,text,text,date,jsonb) from public, anon;
revoke all on function public.krushna_audit_row() from public, anon;
grant execute on function public.krushna_is_member(uuid) to authenticated;
grant execute on function public.krushna_has_role(uuid,text[]) to authenticated;
grant execute on function public.krushna_create_business(text,text,text,text,text,text) to authenticated;
grant execute on function public.krushna_next_invoice_number(uuid,text) to authenticated;
grant execute on function public.krushna_post_invoice(uuid,text,date,uuid,text,text,text,text,boolean,jsonb,numeric) to authenticated;
grant execute on function public.krushna_post_purchase(uuid,uuid,text,text,date,jsonb) to authenticated;

grant usage on schema public to authenticated;
grant select,update on public.krushna_businesses to authenticated;
grant select on public.krushna_memberships to authenticated;
grant select,insert,update,delete on public.krushna_products,public.krushna_parties,public.krushna_itc_records,public.krushna_tds_records to authenticated;
grant select on public.krushna_invoice_sequences,public.krushna_invoices,public.krushna_invoice_lines,public.krushna_purchases,public.krushna_purchase_lines,public.krushna_stock_movements,public.krushna_audit_log to authenticated;
