-- Correct Rule 46 serial length and robust audit trigger return handling.
create or replace function public.krushna_next_invoice_number(p_business_id uuid,p_financial_year text)
returns text language plpgsql security definer set search_path=public as $$
declare n bigint; v_serial text;
begin
 if not public.krushna_has_role(p_business_id,array['owner','admin','manager','cashier']) then raise exception 'Not authorised'; end if;
 if p_financial_year !~ '^\d{4}-\d{2}$' then raise exception 'Financial year must use YYYY-YY'; end if;
 insert into public.krushna_invoice_sequences(business_id,financial_year,last_number) values(p_business_id,p_financial_year,1)
 on conflict(business_id,financial_year) do update set last_number=krushna_invoice_sequences.last_number+1 returning last_number into n;
 v_serial:='KRU/'||substring(p_financial_year from 3 for 2)||'-'||right(p_financial_year,2)||'/'||lpad(n::text,4,'0');
 if length(v_serial)>16 then raise exception 'Invoice serial exceeds GST Rule 46 sixteen-character limit'; end if;
 return v_serial;
end $$;

create or replace function public.krushna_audit_row() returns trigger language plpgsql security definer set search_path=public as $$
declare bid uuid; eid uuid;
begin
 if tg_op='DELETE' then bid:=(to_jsonb(old)->>'business_id')::uuid; eid:=(to_jsonb(old)->>'id')::uuid;
 else bid:=(to_jsonb(new)->>'business_id')::uuid; eid:=(to_jsonb(new)->>'id')::uuid; end if;
 insert into public.krushna_audit_log(business_id,actor_id,action,entity_type,entity_id,detail)
 values(bid,auth.uid(),tg_op,tg_table_name,eid,jsonb_build_object('at',now()));
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
