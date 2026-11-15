-- Transactional posting operations for Krushna. Apply after 202611150001_krushna.sql.
create or replace function public.krushna_post_invoice(
 p_business_id uuid,p_financial_year text,p_invoice_date date,p_customer_id uuid,p_customer_name text,
 p_customer_gstin text,p_place_of_supply text,p_place_of_supply_code text,p_reverse_charge boolean,
 p_lines jsonb,p_amount_paid numeric default 0
) returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_invoice_id uuid; v_number text; v_product public.krushna_products%rowtype; v_line jsonb;
 v_qty numeric(14,3); v_rate numeric(14,2); v_discount numeric(14,2); v_base numeric(14,2);
 v_tax numeric(14,2); v_cgst numeric(14,2); v_sgst numeric(14,2); v_igst numeric(14,2);
 v_taxable numeric(14,2):=0; v_total_cgst numeric(14,2):=0; v_total_sgst numeric(14,2):=0;
 v_total_igst numeric(14,2):=0; v_total numeric(14,2):=0; v_inter boolean;
 v_paid numeric(14,2);
begin
 if not public.krushna_has_role(p_business_id,array['owner','admin','manager','cashier']) then raise exception 'Not authorised'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Invoice requires at least one line'; end if;
 select (state_code<>p_place_of_supply_code) into v_inter from public.krushna_businesses where id=p_business_id;
 if v_inter is null then raise exception 'Business not found'; end if;
 v_number:=public.krushna_next_invoice_number(p_business_id,p_financial_year);
 insert into public.krushna_invoices(business_id,invoice_number,financial_year,invoice_date,customer_id,customer_name,customer_gstin,place_of_supply,place_of_supply_code,reverse_charge,taxable_value,total,amount_paid,status,created_by)
 values(p_business_id,v_number,p_financial_year,p_invoice_date,p_customer_id,p_customer_name,nullif(p_customer_gstin,''),p_place_of_supply,p_place_of_supply_code,coalesce(p_reverse_charge,false),0,0,0,0,auth.uid())
 returning id into v_invoice_id;
 for v_line in select * from jsonb_array_elements(p_lines) loop
  select * into v_product from public.krushna_products where id=(v_line->>'product_id')::uuid and business_id=p_business_id and active for update;
  if not found then raise exception 'Product missing or inactive'; end if;
  v_qty:=(v_line->>'quantity')::numeric;
  if v_qty<=0 then raise exception 'Quantity must be positive'; end if;
  if v_product.stock_qty<v_qty then raise exception 'Insufficient stock for %',v_product.name; end if;
  v_rate:=v_product.selling_price;
  v_discount:=round(coalesce((v_line->>'discount')::numeric,0),2);
  v_base:=round(v_qty*v_rate-v_discount,2);
  if v_base<0 then raise exception 'Discount exceeds line value'; end if;
  v_tax:=round(v_base*v_product.gst_rate/100,2);
  v_cgst:=case when v_inter then 0 else round(v_tax/2,2) end;
  v_sgst:=case when v_inter then 0 else v_tax-v_cgst end;
  v_igst:=case when v_inter then v_tax else 0 end;
  insert into public.krushna_invoice_lines(invoice_id,product_id,description,hsn_sac,quantity,unit,unit_price,discount,taxable_value,gst_rate,cgst,sgst,igst)
  values(v_invoice_id,v_product.id,v_product.name,v_product.hsn_sac,v_qty,v_product.unit,v_rate,v_discount,v_base,v_product.gst_rate,v_cgst,v_sgst,v_igst);
  update public.krushna_products set stock_qty=stock_qty-v_qty,updated_at=now() where id=v_product.id;
  insert into public.krushna_stock_movements(business_id,product_id,movement_type,quantity_delta,reference_type,reference_id,actor_id)
  values(p_business_id,v_product.id,'sale',-v_qty,'invoice',v_invoice_id,auth.uid());
  v_taxable:=v_taxable+v_base; v_total_cgst:=v_total_cgst+v_cgst; v_total_sgst:=v_total_sgst+v_sgst; v_total_igst:=v_total_igst+v_igst;
 end loop;
 v_total:=v_taxable+v_total_cgst+v_total_sgst+v_total_igst;
 v_paid:=least(greatest(coalesce(p_amount_paid,0),0),v_total);
 update public.krushna_invoices set taxable_value=v_taxable,cgst=v_total_cgst,sgst=v_total_sgst,igst=v_total_igst,total=v_total,amount_paid=v_paid,
 status=case when v_paid>=v_total then 'paid' when v_paid>0 then 'part_paid' else 'issued' end where id=v_invoice_id;
 insert into public.krushna_audit_log(business_id,actor_id,action,entity_type,entity_id,detail)
 values(p_business_id,auth.uid(),'ISSUE','invoice',v_invoice_id,jsonb_build_object('invoice_number',v_number,'total',v_total));
 return v_invoice_id;
end $$;
grant execute on function public.krushna_post_invoice(uuid,text,date,uuid,text,text,text,text,boolean,jsonb,numeric) to authenticated;

create or replace function public.krushna_post_purchase(
 p_business_id uuid,p_supplier_id uuid,p_supplier_name text,p_supplier_invoice_no text,p_invoice_date date,p_lines jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_id uuid; v_product public.krushna_products%rowtype; v_line jsonb; v_qty numeric(14,3);
 v_cost numeric(14,4); v_base numeric(14,2); v_tax numeric(14,2); v_taxable numeric(14,2):=0;
 v_cgst numeric(14,2):=0; v_sgst numeric(14,2):=0; v_igst numeric(14,2):=0; v_total numeric(14,2):=0; v_inter boolean;
begin
 if not public.krushna_has_role(p_business_id,array['owner','admin','manager','accountant']) then raise exception 'Not authorised'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Purchase requires at least one line'; end if;
 select (b.state_code<>coalesce(pa.state_code,b.state_code)) into v_inter from public.krushna_businesses b left join public.krushna_parties pa on pa.id=p_supplier_id and pa.business_id=b.id where b.id=p_business_id;
 if v_inter is null then raise exception 'Business not found'; end if;
 insert into public.krushna_purchases(business_id,supplier_id,supplier_name,supplier_invoice_no,invoice_date,taxable_value,total,created_by)
 values(p_business_id,p_supplier_id,p_supplier_name,p_supplier_invoice_no,p_invoice_date,0,0,auth.uid()) returning id into v_id;
 for v_line in select * from jsonb_array_elements(p_lines) loop
  select * into v_product from public.krushna_products where id=(v_line->>'product_id')::uuid and business_id=p_business_id and active for update;
  if not found then raise exception 'Product missing or inactive'; end if;
  v_qty:=(v_line->>'quantity')::numeric; v_cost:=round((v_line->>'unit_cost')::numeric,4);
  if v_qty<=0 or v_cost<0 then raise exception 'Invalid purchase quantity or cost'; end if;
  v_base:=round(v_qty*v_cost,2); v_tax:=round(v_base*v_product.gst_rate/100,2);
  insert into public.krushna_purchase_lines(purchase_id,product_id,quantity,unit_cost,taxable_value,gst_rate)
  values(v_id,v_product.id,v_qty,v_cost,v_base,v_product.gst_rate);
  update public.krushna_products set purchase_cost=case when stock_qty+v_qty=0 then v_cost else round((stock_qty*purchase_cost+v_qty*v_cost)/(stock_qty+v_qty),4) end,
   stock_qty=stock_qty+v_qty,updated_at=now() where id=v_product.id;
  insert into public.krushna_stock_movements(business_id,product_id,movement_type,quantity_delta,reference_type,reference_id,actor_id)
  values(p_business_id,v_product.id,'purchase',v_qty,'purchase',v_id,auth.uid());
  v_taxable:=v_taxable+v_base;
  if v_inter then v_igst:=v_igst+v_tax; else v_cgst:=v_cgst+round(v_tax/2,2); v_sgst:=v_sgst+(v_tax-round(v_tax/2,2)); end if;
 end loop;
 v_total:=v_taxable+v_cgst+v_sgst+v_igst;
 update public.krushna_purchases set taxable_value=v_taxable,cgst=v_cgst,sgst=v_sgst,igst=v_igst,total=v_total where id=v_id;
 insert into public.krushna_audit_log(business_id,actor_id,action,entity_type,entity_id,detail)
 values(p_business_id,auth.uid(),'POST','purchase',v_id,jsonb_build_object('supplier_invoice_no',p_supplier_invoice_no,'total',v_total));
 return v_id;
end $$;
grant execute on function public.krushna_post_purchase(uuid,uuid,text,text,date,jsonb) to authenticated;
